// Shows how many items are in the shared cart, if this device has signed in.
(async () => {
  try {
    const key = localStorage.getItem("fb.key");
    if (!key) return;
    const res = await fetch("/api/cart", { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return;
    const { items } = await res.json();
    const n = items.filter((i) => !i.orderId).length;
    if (n) document.getElementById("cart-count").textContent = n === 1 ? "· פריט אחד" : `· ${n} פריטים`;
  } catch {
    // The cart link still works without the count.
  }
})();
