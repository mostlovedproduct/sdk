// Tiny static server for the demo: http://localhost:4400 (serves packages/web).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT) || 4400;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".map": "application/json", ".css": "text/css", ".svg": "image/svg+xml" };

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  const rel = path === "/" ? "demo/index.html" : normalize(path).replace(/^([/\\])+/, "");
  if (rel.startsWith("..") || !(rel.startsWith("demo/") || rel.startsWith("dist/"))) {
    res.writeHead(404).end("not found");
    return;
  }
  try {
    const body = await readFile(join(root, rel));
    res.writeHead(200, { "Content-Type": types[extname(rel)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => {
  console.log(`demo: http://localhost:${port}/          (posts to http://localhost:8787)`);
  console.log(`      http://localhost:${port}/?mock=1   (offline: fetch is stubbed)`);
});
