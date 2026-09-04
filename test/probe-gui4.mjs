(async () => {
  const r = await fetch("http://127.0.0.1:3080/");
  const t = await r.text();
  const hits = new Set();
  for (const m of t.matchAll(/["'`](\/[a-zA-Z0-9_\-./]*(?:plugin|inventory|loader|setting|api)[a-zA-Z0-9_\-./]*)["'`]/gi)) hits.add(m[1]);
  console.log("path-ish hits:", [...hits].slice(0, 40).join("\n"));
  for (const m of t.matchAll(/__DSH_BOOT__\s*=\s*(\{[^<]*?);/gs)) {
    console.log("boot snippet:", m[1].slice(0, 600));
  }
})();
