(async () => {
  const base = "http://127.0.0.1:3080";
  const tries = [
    ["GET", "/"],
    ["GET", "/sync/api"],
    ["POST", "/sync/api", "{}"],
    ["POST", "/sync/api/status", "{}"],
    ["OPTIONS", "/sync/api/status", null],
    ["GET", "/api/version"],
    ["GET", "/favicon.ico"],
  ];
  for (const [m, p, b] of tries) {
    try {
      const r = await fetch(base + p, { method: m, headers: b ? { "content-type": "application/json", origin: base } : { origin: base }, body: b });
      const t = await r.text();
      const allow = r.headers.get("allow");
      const ct = r.headers.get("content-type");
      console.log(`[${m}] ${p} -> ${r.status} allow=${allow} ct=${ct} len=${t.length} head=${t.slice(0, 90).replace(/\s+/g, " ")}`);
    } catch (e) {
      console.log(`[${m}] ${p} ERR ${e.message}`);
    }
  }
})();
