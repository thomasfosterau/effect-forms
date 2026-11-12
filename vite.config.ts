/**
 * Workspace-root Vite+ configuration. Owns the repo-wide format / lint /
 * staged passes (read statically by `vp fmt` / `vp lint` / `vp staged`) and
 * the root aggregate tasks (`check`, `docgen`, `test:coverage`). Each
 * package's own tasks and `pack` / `test` config live in its own
 * `vite.config.ts` (`packages/forms`, `packages/svelte`).
 *
 * The shape is the library standard's (effect-web's root config); the
 * comments that explain a load-bearing decision travel with it.
 *
 * @copyright Thomas Foster
 */

import { recommended } from "@effect/tsgo/oxlint-presets";
import effect from "@enfect/oxlint";
import { defineConfig } from "vite-plus";

export default defineConfig({
  // Staged-file checks run by `vp staged` (the pre-commit hook).
  // Format with fixes, lint WITHOUT them: `vp check --fix` would also apply
  // the autofixes of type-aware rules (such as
  // `no-unnecessary-type-assertion`) to staged files at commit time, so the
  // commit would differ from the tree that was verified.
  // `--no-error-on-unmatched-pattern`: a commit that stages only CSS / JSON /
  // Markdown leaves the lint step no file to lint.
  staged: {
    "*.{js,ts,css,json,md}": [
      "vp check --fix --no-lint",
      "vp check --no-fmt --no-error-on-unmatched-pattern",
    ],
  },

  /** `vp fmt` / `vp check` (Oxfmt) */
  fmt: {
    ignorePatterns: ["**/dist/**", "**/docs/**", "**/coverage/**"],
  },

  /** `vp lint` / `vp check` (Oxlint, with `@enfect/oxlint` and `@effect/tsgo`'s Effect rule sets) */
  lint: {
    ignorePatterns: ["**/dist/**", "**/docs/**", "**/coverage/**", "**/node_modules/**"],
    extends: [recommended, effect.configs.recommended],
    plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "promise", "vitest", "jsdoc"],
    categories: {
      correctness: "error",
      suspicious: "error",
      perf: "error",
    },
    // Every rule is at `error`, and nothing is disabled inline. The only
    // exceptions are the scoped `off` overrides below: sites where a rule
    // cannot apply, each with its reason. A new override needs the same.
    rules: {
      "effect/prefer-namespace-imports": "error",
      "effect/casting-awareness": "error",
      "effect/prefer-option-over-null": "error",
      "effect/no-unknown-parameters": "error",
      "effect/no-unknown-returns": "error",
      "effect/no-unsafe-dictionary-type": "error",

      "vite-plus/prefer-vite-plus-imports": "error",

      // ---- @effect/tsgo preset rules the preset leaves at `warn` (#116) ----
      "effecttsgo/schema-class-missing-brand": "error",
      "effecttsgo/schema-number": "error",
      "effecttsgo/effect-succeed-with-void": "error",
      "effecttsgo/unnecessary-typeof-type": "error",
      "effecttsgo/unknown-in-effect-catch": "error",
      "effecttsgo/prefer-typed-schema-decoder": "error",
      "effecttsgo/unstable-api-usage": "error",

      // ---- Type-aware rules (tsgolint, #91) --------------------------------
      "typescript/no-unsafe-type-assertion": "error",
      "effecttsgo/any-unknown-in-error-context": "error",
      "effecttsgo/unsafe-effect-type-assertion": "error",
      "typescript/no-unnecessary-type-parameters": "error",
      "typescript/no-generated-empty-object-type": "error",

      // ---- Oxlint's own plugins ---------------------------------------------
      "eslint/no-underscore-dangle": "error",
      "vitest/require-mock-type-parameters": "error",
      // `@effect/vitest`'s `it.effect` / `it.live` (and the `it` a `layer`
      // block hands its callback) register a test like `it` does, so an
      // `expect` in their body is inside a test, not standalone (#161).
      "vitest/no-standalone-expect": [
        "error",
        { additionalTestBlockFunctions: ["it.effect", "it.live"] },
      ],
    },
    // ---- Can't-apply sites ----------------------------------------------------
    overrides: [
      // `@effect/vitest` marks `it` / `layer` unstable, and every suite that
      // runs an Effect uses them (the test convention in AGENTS.md).
      {
        files: ["**/tests/**"],
        rules: {
          "effecttsgo/unstable-api-usage": "off",
        },
      },
      // The store's default submit is an Effect `HttpClient` over
      // `FetchHttpClient.layer`, and `effect/http/*` is marked unstable.
      // `message` mirrors the wire `FormState.message?` and is rendered
      // directly in markup (family decision: Svelte-rendered / wire-mirroring
      // values stay native). `#detachedData` claims `A` back from
      // `$state.snapshot`, whose `Snapshot<A>` can't be related to a generic
      // `A` (`// SAFETY:` at the site).
      {
        files: ["packages/svelte/src/FormStore.svelte.ts"],
        rules: {
          "effecttsgo/unstable-api-usage": "off",
          "effect/prefer-option-over-null": "off",
          "typescript/no-unsafe-type-assertion": "off",
          "effect/casting-awareness": "off",
        },
      },
      // Wire shapes and literal values. `FormErrors`, `InputConstraints` and
      // `TaintedFields` are plain-JSON trees whose index signatures must
      // admit `undefined` (an absent key); an `Option` is not JSON.
      // `FormLeaf` is the `null` / `undefined` an input or a posted body holds
      // for a blank, and `ProbeInput` the literal `null` / `undefined` a probe
      // feeds a field schema: values, not absence.
      {
        files: [
          "packages/forms/src/Errors.ts",
          "packages/forms/src/Constraints.ts",
          "packages/forms/src/Path.ts",
          "packages/forms/src/Command.ts",
          "packages/svelte/src/Tainted.ts",
        ],
        rules: {
          "effect/prefer-option-over-null": "off",
        },
      },
    ],
    // Type-aware linting through oxlint-tsgolint (bundled with Vite+; patched
    // by `effect-tsgo patch --oxlint`, so the `effecttsgo/*` rules run too).
    // `typeCheck` also reports TypeScript errors in `vp check`; it overlaps the
    // `check` tasks (native Effect-patched `tsc` plus svelte-check) without
    // conflicting, and gives the pre-commit hook a type check. tsgolint reads
    // each file's nearest `tsconfig.json`, so `packages/svelte/tsconfig.json`
    // maps the core to its `src/`: `vp check` runs on a clean checkout, before
    // any `dist/` exists (as CI runs it), while the `check` task still types
    // the svelte package against the core's built declarations
    // (`packages/svelte/tsconfig.check.json`).
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },

  run: {
    cache: true,
    tasks: {
      // The type gate (`vp run check`): this root config under the native
      // `tsc`, after every package's `check` (`tsc` over `src` + tests, plus
      // svelte-check over `packages/svelte`). A `from: "dependencies"` edge
      // does not traverse the workspace root's own devDependencies, so the
      // packages are named one by one: a new package adds itself to EVERY
      // list here (`check`, `docgen` where it has one, `test:coverage`).
      check: {
        command: "tsc -p tsconfig.json",
        dependsOn: [
          "@thomasfosterau/effect-forms#check",
          "@thomasfosterau/effect-forms-svelte#check",
        ],
        cache: false,
      },
      // Compiles AND RUNS every JSDoc `@example` against the built `dist/`,
      // then writes the (git-ignored) API reference under `packages/forms/docs/`.
      // Only the core has a docgen: the Svelte bindings' examples are Svelte
      // components and SvelteKit route modules, which need the Svelte compiler
      // and SvelteKit's virtual modules to run.
      docgen: {
        command: "echo 'docgen: every example compiled and ran'",
        dependsOn: ["@thomasfosterau/effect-forms#docgen"],
        cache: false,
      },
      // Every package's unit suite under one Istanbul coverage map
      // (`coverage/coverage-final.json`), which `fallow audit` reads for exact
      // per-function CRAP scores (`health.coverage` in .fallowrc.json).
      // Without it fallow estimates every function as uncovered, and any
      // function with cyclomatic complexity ≥ 5 fails the gate on its own.
      // Run this before `fallow audit` (the Claude Code PreToolUse fallow gate
      // runs the audit on `git commit` / `git push` but never refreshes this
      // map). One vitest process runs every project, so each package's
      // `build` is named explicitly: the svelte suite imports the core
      // through its `exports` (→ `dist/`).
      "test:coverage": {
        command: "vp test run --coverage",
        dependsOn: [
          "@thomasfosterau/effect-forms#build",
          "@thomasfosterau/effect-forms-svelte#build",
        ],
        cache: false,
      },
    },
  },

  test: {
    // One entry per package: each package's own vite.config.ts is a vitest
    // project, so the root run and the root coverage map cover them all.
    projects: ["packages/*/vite.config.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary", "json"],
      reportsDirectory: "./coverage",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.d.ts"],
    },
  },
});
