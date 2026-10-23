// Errors that carry an HTTP status; server.js turns them into JSON responses.
function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

module.exports = { fail };
