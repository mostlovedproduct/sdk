import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    protocol: "src/protocol/index.ts",
  },
  format: ["esm"],
  splitting: true,
  dts: true,
  target: "es2022",
  platform: "neutral",
  // Match package.json so Rollup removes redundant side-effect imports between chunks.
  treeshake: { moduleSideEffects: false },
  sourcemap: true,
  clean: true,
});
