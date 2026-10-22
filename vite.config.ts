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
import effect from "@mpsuesser/oxlint-plugin-effect";
import { defineConfig } from "vite-plus";

export default defineConfig({
  // Staged-file checks run by `vp staged` (the pre-commit hook).
  staged: {
    "*.{js,ts,css,json,md}": "vp check --fix",
  },

  /** `vp fmt` / `vp check` (Oxfmt) */
  fmt: {
    ignorePatterns: ["**/dist/**", "**/docs/**", "**/coverage/**"],
  },

  /** `vp lint` / `vp check` (Oxlint, with the Effect rule sets) */
  lint: {
    ignorePatterns: ["**/dist/**", "**/docs/**", "**/coverage/**", "**/node_modules/**"],
    extends: [recommended, effect.configs.recommended],
    categories: {
      correctness: "error",
    },
    rules: {
      // Hard-codes abbreviations (`Arr`, `P`, `R`, …) with no options, so it is
      // unsatisfiable under the full-name convention (`import * as Option from
      // "effect/Option"`) this family shares with its consumers.
      "effect/prefer-namespace-imports": "off",
      // `casting-awareness` is an awareness prompt, not a defect rule — it
      // fires on every `as`, including the ones
      // `require-safety-comment-for-type-assertion` (at `error`) already makes
      // justify themselves. Stays visible as a warning.
      "effect/casting-awareness": "warn",

      // ---- Effect preset: rules the published API shape cuts across -------
      // Each of these asks for a different *signature*, not a different
      // implementation, and every site is in (or feeds) the published API the
      // consuming applications compile against: changing one is a breaking
      // release of both packages, decided per export in an issue, never as a
      // lint sweep. They stay visible as warnings.
      //
      // `prefer-option-over-null` also fires on `?: T | undefined`, which is
      // the ONLY spelling of an optional member `exactOptionalPropertyTypes`
      // lets a caller forward an optional of its own into, and on the
      // `T | undefined` readers a Svelte template binds to directly.
      "effect/prefer-option-over-null": "warn",
      // `unknown` is the honest type at the boundary a form library IS: a
      // posted `FormData` / JSON body before its schema decodes it, a
      // command's failure before a classifier reads it, a free-form message
      // payload. Narrowing these would move the parse out of the library and
      // into every caller.
      "effect/no-unknown-parameters": "warn",
      "effect/no-unknown-returns": "warn",
      "effect/no-unsafe-dictionary-type": "warn",

      "vite-plus/prefer-vite-plus-imports": "error",
    },
    overrides: [
      // Build/test configs are evaluated by Vite and Vitest in bare Node,
      // before any Effect runtime exists — there is no `Config` provider to
      // read from and no `FileSystem` service to call, so `process.env` and
      // `node:*` are the only things that work there. The Effect preset's
      // service rules have no satisfiable fix in these files.
      {
        files: ["**/vite.config.ts", "**/svelte.config.js"],
        rules: {
          "effect/avoid-node-imports": "off",
          "effect/avoid-process-env": "off",
        },
      },
      // Tests are the runtime boundary: `@effect/vitest` is not a dependency,
      // so a suite runs its Effects with `Effect.runPromise` / `runSync`.
      {
        files: ["**/tests/**/*.ts"],
        rules: {
          "effect/effect-run-in-body": "off",
        },
      },
      // Its expect-error directives ARE the assertions: each marks a
      // `FieldPath` / `PathValue` misuse that must fail to compile.
      {
        files: ["packages/forms/tests/Path.test.ts"],
        rules: {
          "effect/avoid-ts-ignore": "off",
        },
      },
      // Pins that the body encoder drops native `Map` / `Set` values, so the
      // fixtures must be the native collections.
      {
        files: ["packages/svelte/tests/EnhanceCore.test.ts"],
        rules: {
          "effect/avoid-native-object-helpers": "off",
        },
      },
      // The store is the browser's runtime boundary: its default submit is the
      // platform `fetch` (an Effect HttpClient would add runtime weight to every
      // consumer's bundle), it interrupts its own validator fibers with
      // `Effect.runFork` from synchronous Svelte event / teardown code, and its
      // submit wraps a caller's Promise handler in try / finally to reset
      // `submitting` / `delayed` at exactly the point it does today.
      {
        files: ["packages/svelte/src/FormStore.svelte.ts"],
        rules: {
          "effect/avoid-native-fetch": "off",
          "effect/effect-run-in-body": "off",
          "effect/avoid-try-catch": "off",
        },
      },
      // `validateValueSync` is the published synchronous API; its
      // `Effect.runSync` is the boundary by design.
      {
        files: ["packages/forms/src/Validate.ts"],
        rules: {
          "effect/effect-run-in-body": "off",
        },
      },
      // `structuredFromField`'s contract (tested) is to throw the platform
      // `SyntaxError` on malformed JSON, which only `JSON.parse` produces.
      {
        files: ["packages/forms/src/Command.ts"],
        rules: {
          "effect/avoid-direct-json": "off",
        },
      },
      // `valid` / `posted` are fields of the published `FormState` wire
      // format (`FormStateSchema`); renaming them breaks every consumer.
      {
        files: ["packages/forms/src/State.ts"],
        rules: {
          "effect/require-is-prefix-for-boolean-schema-field": "off",
        },
      },
      // A builder `refine` becomes an anonymous, per-form filter; an
      // `identifier` / `title` / `description` would surface as JSON Schema
      // annotations in the caller's own schema.
      {
        files: ["packages/forms/src/FormBuilder.ts"],
        rules: {
          "effect/require-filter-metadata": "off",
        },
      },
    ],
    // Type-aware linting is off: type checking is the `check` tasks' job
    // (native `tsc`, Effect-patched, plus svelte-check), which run after the
    // sibling build the svelte package's types resolve through. `vp check`
    // stays format + lint, runnable on a clean checkout.
    options: {
      typeAware: false,
      typeCheck: false,
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
