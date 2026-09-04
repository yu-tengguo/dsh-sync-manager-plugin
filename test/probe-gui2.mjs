(async () => {
  const cases = [
    ["POST", "http://127.0.0.1:3080/ego/api/gateways", "{}"],
    ["POST", "http://127.0.0.1:3080/ego/api/list", "{}"],
    ["POST", "http://127.0.0.1:3080/sync/api/status", "{}"],
  ];
  for (const [m, u, b] of cases) {
    try {
      const r = await fetch(u, { method: m, headers: { "content-type": "application/json" }, body: b });
      const t = await r.text();
      console.log(`[${m}] ${u} -> ${r.status} ${t.slice(0, 180)}`);
    } catch (e) {
      console.log(`[${m}] ERR ${e.message}`);
    }
  }
})();
