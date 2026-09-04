const cases = [
  ["GET", "http://127.0.0.1:3080/sync/api/status"],
  ["POST", "http://127.0.0.1:3080/sync/api/status"],
  ["POST", "http://127.0.0.1:3080/sync/api/nosuch"],
  ["GET", "http://127.0.0.1:3080/ego/api/gateways"],
];
(async () => {
  for (const [m, u] of cases) {
    try {
      const r = await fetch(u, { method: m, headers: { "content-type": "application/json" }, body: m === "POST" ? "{}" : undefined });
      const t = await r.text();
      console.log(`[${m}] ${u} -> HTTP ${r.status} body=${t.slice(0, 200).replace(/\s+/g, " ")}`);
    } catch (e) {
      console.log(`[${m}] ERR ${e.message}`);
    }
  }
})();
