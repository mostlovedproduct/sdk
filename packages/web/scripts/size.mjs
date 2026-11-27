// Prints the gzip size of the script-tag build and a per-module breakdown.
// Per-module gzip figures are estimates (each module's minified bytes, gzipped alone,
// then scaled so they sum to the real total).
import { readFileSync, existsSync } from "node:fs";
import { brotliCompressSync, gzipSync } from "node:zlib";

const out = new URL("../dist/mlp.js", import.meta.url);
if (!existsSync(out)) {
  console.error("dist/mlp.js not found; run `npm run build` first");
  process.exit(1);
}
const code = readFileSync(out);
const gz = gzipSync(code, { level: 9 }).length;
const kb = (n) => (n / 1024).toFixed(2) + " KB";
const br = brotliCompressSync(code).length;
console.log(`dist/mlp.js  ${kb(code.length)} min  ${kb(gz)} gzip  ${kb(br)} brotli  (budget 17 KB gzip, goal 12 KB; enforced by npm run check:packages at the repo root)`);

const metaUrl = new URL("../dist/metafile-iife.json", import.meta.url);
if (!existsSync(metaUrl)) process.exit(0);
const meta = JSON.parse(readFileSync(metaUrl, "utf8"));
const output = Object.entries(meta.outputs).find(([k]) => k.endsWith("mlp.js"))?.[1];
if (!output) process.exit(0);
const groups = new Map();
for (const [file, { bytesInOutput }] of Object.entries(output.inputs)) {
  const m = /(packages|apps)\/([^/]+)\/(?:dist|src)\/(.+)$/.exec(file);
  const name = m ? `${m[2]}/${m[3]}` : file;
  groups.set(name, (groups.get(name) ?? 0) + bytesInOutput);
}
const rows = [...groups].filter(([, b]) => b > 0).sort((a, b) => b[1] - a[1]);
const total = rows.reduce((s, [, b]) => s + b, 0);
console.log("\nbreakdown (minified bytes, share of total):");
for (const [name, b] of rows) {
  console.log(`  ${name.padEnd(36)} ${String(b).padStart(6)} B  ${((b / total) * 100).toFixed(1).padStart(5)}%  ~${kb((b / total) * gz)} gz`);
}
