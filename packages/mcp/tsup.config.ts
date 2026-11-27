import { defineConfig } from "tsup";

// The root entry depends only on @mostlovedproduct/core. The sdk entry additionally
// needs the official MCP SDK and zod, both left to the customer (peers).
export default defineConfig({
  entry: { index: "src/index.ts", sdk: "src/sdk.ts" },
  format: ["esm"],
  dts: true,
  target: "es2022",
  platform: "neutral",
  treeshake: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  external: ["@mostlovedproduct/core", /^@modelcontextprotocol\/sdk/, "zod"],
});
