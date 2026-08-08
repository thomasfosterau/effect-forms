import { defineConfig } from "vite-plus";

export default defineConfig({
  // Defined as Vite+ tasks rather than package.json scripts: a package.json
  // script can never be cached, however pure it is.
  run: {
    tasks: {
      build: "vp pack",
      test: "vp test run",
    },
  },

  /**
   * `vp pack` (tsdown) builds the publishable, framework-neutral library.
   *
   * `platform: "neutral"` because nothing here touches Node or the DOM — the
   * package is pure Effect Schema plumbing and must stay usable in a browser,
   * a Worker, and Node alike.
   */
  pack: {
    entry: ["src/index.ts"],
    format: ["esm"],
    platform: "neutral",
    dts: true,
    sourcemap: true,
  },

  /** `vp test` (Vitest) */
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["**/*.d.ts"],
    },
  },
});
