#!/usr/bin/env node
// Checks the public packages as npm would publish them. Run after building them:
//   npm run check:packages
// Publishes nothing: `npm pack --dry-run` only lists the tarball's contents.
//
// This is a public file, so it must not import any private packages. It may import Node.js built-ins and public packages.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = fileURLToPath(new URL("..", import.meta.url));
const PACKAGES = ["core", "mcp", "web"];
const REPOSITORY = "git+https://github.com/mostlovedproduct/sdk.git";
// Gzip budget for the script-tag build. The goal is 12 KB; this ceiling stops growth until the widget is trimmed.
const MLP_JS_BUDGET_BYTES = 17 * 1024;
// Anything else in a tarball is a mistake: sources, tests, demos and scripts stay in the repository.
const ALLOWED_FILE = /^(package\.json|README\.md|CHANGELOG\.md|LICENSE|dist\/[^/]+\.(js|js\.map|d\.ts))$/;

const failures = [];
const packed = {};
const fail = (pkg, message) => failures.push(`${pkg}: ${message}`);

const manifests = Object.fromEntries(
  PACKAGES.map((dir) => [dir, JSON.parse(readFileSync(join(root, "packages", dir, "package.json"), "utf8"))]),
);
const versions = new Set(Object.values(manifests).map((m) => m.version));
if (versions.size !== 1) failures.push(`versions differ (${[...versions].join(", ")}); the packages are released in lockstep`);

for (const dir of PACKAGES) {
  const manifest = manifests[dir];
  const name = manifest.name;

  if (manifest.private) fail(name, "is marked private");
  if (manifest.license !== "MIT") fail(name, `license is ${manifest.license}, expected MIT`);
  if (manifest.repository?.url !== REPOSITORY || manifest.repository?.directory !== `packages/${dir}`) {
    fail(name, `repository must be ${REPOSITORY} with directory packages/${dir}`);
  }
  for (const field of ["description", "homepage", "author"]) if (!manifest[field]) fail(name, `missing ${field}`);
  if (!manifest.bugs?.url) fail(name, "missing bugs.url");
  if (manifest.publishConfig?.access !== "public") fail(name, "publishConfig.access must be public");
  if (manifest.publishConfig?.provenance !== true) fail(name, "publishConfig.provenance must be true");

  for (const [dep, range] of Object.entries(manifest.dependencies ?? {})) {
    if (!dep.startsWith("@mostlovedproduct/")) continue;
    const target = Object.values(manifests).find((m) => m.name === dep);
    if (!target) fail(name, `depends on ${dep}, which is not a public package`);
    else if (range !== target.version) fail(name, `depends on ${dep}@${range}, but the workspace has ${target.version}`);
  }

  const [pack] = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: join(root, "packages", dir),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  const files = new Set(pack.files.map((f) => f.path));
  packed[dir] = files;
  for (const required of ["package.json", "README.md", "LICENSE"]) if (!files.has(required)) fail(name, `tarball is missing ${required}`);
  for (const file of files) if (!ALLOWED_FILE.test(file)) fail(name, `tarball contains unexpected file ${file}`);

  const targets = [manifest.main, manifest.types];
  const collect = (value) => {
    if (typeof value === "string") targets.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(manifest.exports);
  for (const target of targets.filter(Boolean)) {
    const path = target.replace(/^\.\//, "");
    if (!files.has(path)) fail(name, `${target} is referenced by package.json but missing from the tarball`);
  }

  console.log(`${name}@${manifest.version}  ${pack.entryCount} files  ${(pack.size / 1024).toFixed(1)} KB packed`);
}

// The web changelog carries each release's pinned CDN URL and integrity value (npm run upload:cdn -- --changelog).
const webChangelog = readFileSync(join(root, "packages", "web", "CHANGELOG.md"), "utf8");
if (!webChangelog.includes(`\n## ${manifests.web.version} `) && !webChangelog.includes(`\n## ${manifests.web.version}\n`)) {
  fail(manifests.web.name, `CHANGELOG.md has no "## ${manifests.web.version}" entry`);
}
if (!packed.web.has("CHANGELOG.md")) fail(manifests.web.name, "tarball is missing CHANGELOG.md");

const mlpJs = readFileSync(join(root, "packages", "web", "dist", "mlp.js"));
const gzip = gzipSync(mlpJs, { level: 9 }).length;
const banner = `/*! @mostlovedproduct/web v${manifests.web.version} | MIT License`;
if (!mlpJs.subarray(0, 300).toString("utf8").includes(banner)) fail("mlp.js", `does not start with the license banner for v${manifests.web.version}`);
if (gzip > MLP_JS_BUDGET_BYTES) fail("mlp.js", `${(gzip / 1024).toFixed(2)} KB gzip is over the ${MLP_JS_BUDGET_BYTES / 1024} KB budget`);
console.log(`mlp.js  ${(gzip / 1024).toFixed(2)} KB gzip (budget ${MLP_JS_BUDGET_BYTES / 1024} KB)`);

if (failures.length) {
  console.error(`\n${failures.length} problem(s):\n${failures.map((f) => `- ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("Public packages are ready to pack.");
