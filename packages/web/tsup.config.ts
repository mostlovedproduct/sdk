import { defineConfig } from "tsup";
import { version } from "./package.json";

// Customers serve mlp.js without the package's LICENSE file, so the notice travels in the file.
const licenseBanner = `/*! @mostlovedproduct/web v${version} | MIT License | https://mostlovedproduct.com */`;

export default defineConfig([
  {
    // npm: ESM + types. core stays a dependency so bundlers dedupe it.
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    target: "es2022",
    platform: "browser",
    treeshake: true,
    sourcemap: true,
    clean: true,
    external: ["@mostlovedproduct/core"],
  },
  {
    // Script tag: one self-contained, minified IIFE with the capture client inlined.
    entry: { mlp: "src/iife.ts" },
    format: ["iife"],
    outExtension: () => ({ js: ".js" }),
    target: "es2022",
    platform: "browser",
    minify: true,
    treeshake: true,
    sourcemap: true,
    metafile: true,
    noExternal: ["@mostlovedproduct/core"],
    banner: { js: licenseBanner },
    clean: false,
  },
]);
