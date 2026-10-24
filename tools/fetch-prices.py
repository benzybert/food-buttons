"""Download tonight's price and store files for the chains in public/data/stores.json.

Used by the nightly GitHub Action (.github/workflows/prices.yml); the output feeds tools/ingest-prices.js.

For every chain it tries, in order:
  1. the chain's own site, through il-supermarket-scraper (OpenIsraeliSupermarkets): a few PriceFull files
     (one per branch) and the Stores file;
  2. if that gave no price file (some sites block requests from outside Israel, which is where GitHub's runners are),
     the daily dataset that OpenIsraeliSupermarkets publishes on Kaggle (needs KAGGLE_API_TOKEN, or
     KAGGLE_USERNAME + KAGGLE_KEY, in the environment).

Output: <out>/<store id>/ with the files and a SOURCE file ("scraper" or "kaggle"), and <out>/manifest.json.
A chain that fails both ways is left out; the ingest keeps its previous prices (--keep-missing).

    python tools/fetch-prices.py --out downloads [--branches 6] [--only shufersal,victory] [--timeout 900]

The scraper and the dataset are by Sefi Erlich / OpenIsraeliSupermarkets, licensed for non-commercial use only,
with attribution: https://github.com/OpenIsraeliSupermarkets. This script installs and calls them; it copies none of
their code.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

DATASET = "erlichsefi/israeli-supermarkets-2024"

# Our store id -> scraper names to try (il_supermarket_scarper.ScraperFactory) and the chain's name in the dataset's
# file names (DumpFolderNames, lowercased). Yeinot Bitan now trades as Carrefour and publishes as one chain with it.
CHAINS = {
    "shufersal": {"scrapers": ["SHUFERSAL"], "dataset": ["shufersal"]},
    "ramilevy": {"scrapers": ["RAMI_LEVY"], "dataset": ["ramilevy"]},
    "victory": {"scrapers": ["VICTORY_NEW_SOURCE"], "dataset": ["victorynewsource", "victory"]},
    "osherad": {"scrapers": ["OSHER_AD"], "dataset": ["osherad"]},
    "yochananof": {"scrapers": ["YOHANANOF"], "dataset": ["yohananof"]},
    "carrefour": {"scrapers": ["YAYNO_BITAN_AND_CARREFOUR"], "dataset": ["yaynotbitanandcarrefour"]},
    "tivtaam": {"scrapers": ["TIV_TAAM"], "dataset": ["tivtaam"]},
}

PRICE_RE = re.compile(r"pricefull|price_full", re.I)
STORES_RE = re.compile(r"^stores|store_file|stores_file", re.I)


def log(msg):
    print(msg, flush=True)


# ------------------------------------------------------------------ scraper (runs in a child process per chain)


def scrape_one(scraper, kind, limit, dest):
    """Child process: download `limit` files of one type for one chain into dest (disk output of the scraper)."""
    from il_supermarket_scarper import ScarpingTask  # pylint: disable=import-outside-toplevel

    task = ScarpingTask(
        enabled_scrapers=[scraper],
        files_types=[kind],
        multiprocessing=1,
        output_configuration={"output_mode": "disk", "base_storage_path": dest},
        status_configuration={"database_type": "json", "base_path": os.path.join(dest, "status")},
        timeout_in_seconds=600,
    )
    task.start(limit=limit)
    task.join()


def files_in(folder, pattern):
    return sorted(p for p in Path(folder).rglob("*") if p.is_file() and pattern.search(p.name) and "status" not in p.parts)


def try_scraper(chain, cfg, out, branches, timeout):
    for scraper in cfg["scrapers"]:
        raw = Path(tempfile.mkdtemp(prefix=f"scrape-{chain}-"))
        errors = []
        for kind, limit in (("PRICE_FULL_FILE", branches), ("STORE_FILE", 1)):
            try:
                r = subprocess.run([sys.executable, __file__, "--scrape-one", scraper, kind, str(limit), str(raw)], timeout=timeout, check=False, capture_output=True, text=True)
                if r.returncode != 0:
                    errors.append(f"{kind}: {(r.stderr or '').strip().splitlines()[-1:] or ['exit ' + str(r.returncode)]}")
            except subprocess.TimeoutExpired:
                errors.append(f"{kind}: timed out after {timeout}s")
        for e in errors:
            log(f"  {scraper} {e}")
        prices = files_in(raw, PRICE_RE)
        if prices:
            for f in prices + files_in(raw, STORES_RE):
                shutil.copy2(f, out / f.name)
            shutil.rmtree(raw, ignore_errors=True)
            return {"source": "scraper", "scraper": scraper, "files": len(prices)}
        seen = [p.name for p in Path(raw).rglob("*") if p.is_file()][:8]
        log(f"  {scraper}: no price files; downloaded: {seen or 'nothing'}")
        shutil.rmtree(raw, ignore_errors=True)
    return None


# ------------------------------------------------------------------ Kaggle


def kaggle_ready():
    return bool(os.environ.get("KAGGLE_API_TOKEN") or (os.environ.get("KAGGLE_USERNAME") and os.environ.get("KAGGLE_KEY")))


_api = None


def kaggle_api():
    """The Kaggle client, authenticated from the environment (KAGGLE_API_TOKEN or KAGGLE_USERNAME + KAGGLE_KEY)."""
    global _api  # pylint: disable=global-statement
    if _api is None:
        from kaggle.api.kaggle_api_extended import KaggleApi  # pylint: disable=import-outside-toplevel

        _api = KaggleApi()
        _api.authenticate()
    return _api


_listing = None


def dataset_files():
    """Every file name in the dataset (paged)."""
    global _listing  # pylint: disable=global-statement
    if _listing is not None:
        return _listing
    names, token = [], None
    try:
        for _ in range(50):
            res = kaggle_api().dataset_list_files(DATASET, page_token=token, page_size=200)
            names += [f.name for f in (res.files or [])]
            token = res.next_page_token
            if not token:
                break
    except Exception as err:  # pylint: disable=broad-except
        log(f"  listing the dataset failed: {err}")
    _listing = [n for n in names if n]
    log(f"  dataset: {len(_listing)} files")
    return _listing


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def pick_dataset_files(names, aliases):
    """The dataset files that belong to this chain: price-full CSVs and store CSVs, or the chain's zip."""
    keys = [norm(a) for a in aliases]

    def belongs(name):
        stem = norm(Path(name).stem)
        return any(stem == k or stem.endswith(k) or stem.startswith(k) for k in keys)

    mine = [n for n in names if belongs(n)]
    # Prefer the most specific alias (victorynewsource over victory) when both exist.
    for k in keys:
        exact = [n for n in mine if norm(Path(n).stem).endswith(k) or norm(Path(n).stem).startswith(k)]
        if exact:
            mine = exact
            break
    wanted = [n for n in mine if n.lower().endswith(".zip") or PRICE_RE.search(n) or STORES_RE.search(Path(n).name)]
    return [n for n in wanted if "promo" not in n.lower()]


def try_kaggle(chain, cfg, out):
    if not kaggle_ready():
        log("  no Kaggle credentials: skipping the dataset")
        return None
    names = pick_dataset_files(dataset_files(), cfg["dataset"])
    if not names:
        log(f"  dataset has no files for {cfg['dataset']}")
        return None
    tmp = Path(tempfile.mkdtemp(prefix=f"kaggle-{chain}-"))
    for name in names:
        try:
            kaggle_api().dataset_download_file(DATASET, name, path=str(tmp), quiet=True)
        except Exception as err:  # pylint: disable=broad-except
            log(f"  download {name} failed: {err}")
    for z in list(tmp.rglob("*.zip")):
        try:
            with zipfile.ZipFile(z) as zf:
                for member in zf.namelist():
                    base = Path(member).name
                    if base and "promo" not in base.lower() and (PRICE_RE.search(base) or STORES_RE.search(base)):
                        with zf.open(member) as src, open(tmp / base, "wb") as dst:
                            shutil.copyfileobj(src, dst)
        except zipfile.BadZipFile:
            log(f"  {z.name} is not a zip")
        z.unlink()
    prices = files_in(tmp, PRICE_RE)
    if not prices:
        shutil.rmtree(tmp, ignore_errors=True)
        return None
    for f in prices + files_in(tmp, STORES_RE):
        shutil.move(str(f), out / f.name)
    shutil.rmtree(tmp, ignore_errors=True)
    return {"source": "kaggle", "files": len(prices)}


# ------------------------------------------------------------------ main


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="downloads")
    ap.add_argument("--branches", type=int, default=6, help="PriceFull files (branches) per chain from the chain's site")
    ap.add_argument("--only", default="", help="comma-separated store ids")
    ap.add_argument("--timeout", type=int, default=900, help="seconds per chain and file type")
    ap.add_argument("--no-scraper", action="store_true", help="go straight to the dataset")
    args = ap.parse_args()

    root = Path(args.out)
    root.mkdir(parents=True, exist_ok=True)
    only = {s for s in args.only.split(",") if s}
    manifest = {}
    for chain, cfg in CHAINS.items():
        if only and chain not in only:
            continue
        log(f"{chain}:")
        out = root / chain
        shutil.rmtree(out, ignore_errors=True)
        out.mkdir(parents=True)
        got = None if args.no_scraper else try_scraper(chain, cfg, out, args.branches, args.timeout)
        if not got:
            got = try_kaggle(chain, cfg, out)
        if got:
            (out / "SOURCE").write_text(got["source"] + "\n", encoding="utf-8")
            log(f"  ok: {got}")
        else:
            shutil.rmtree(out, ignore_errors=True)
            log("  nothing today")
        manifest[chain] = got
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    ok = [c for c, v in manifest.items() if v]
    log(f"\n{len(ok)}/{len(manifest)} chains: {', '.join(ok) or 'none'}")
    return 0 if ok else 1


if __name__ == "__main__":
    if len(sys.argv) == 6 and sys.argv[1] == "--scrape-one":
        scrape_one(sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5])
        sys.exit(0)
    sys.exit(main())
