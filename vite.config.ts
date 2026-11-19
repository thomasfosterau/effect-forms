import { recommended } from "@effect/tsgo/oxlint-presets";
import effect from "@enfect/oxlint";
import { defineConfig } from "vite-plus";

export default defineConfig({
  // Format with fixes, lint without: a type-aware autofix at commit time would
  // make the commit differ from the tree that was verified.
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
    rules: {
      "effect/prefer-namespace-imports": "error",
      "effect/casting-awareness": "error",
      "effect/prefer-option-over-null": "error",
      "effect/no-unknown-parameters": "error",
      "effect/no-unknown-returns": "error",
      "effect/no-unsafe-dictionary-type": "error",

      "vite-plus/prefer-vite-plus-imports": "error",

      // @effect/tsgo preset rules the preset leaves at `warn`.
      "effecttsgo/schema-class-missing-brand": "error",
      "effecttsgo/schema-number": "error",
      "effecttsgo/effect-succeed-with-void": "error",
      "effecttsgo/unnecessary-typeof-type": "error",
      "effecttsgo/unknown-in-effect-catch": "error",
      "effecttsgo/prefer-typed-schema-decoder": "error",
      "effecttsgo/unstable-api-usage": "error",

      "typescript/no-unsafe-type-assertion": "error",
      "effecttsgo/any-unknown-in-error-context": "error",
      "effecttsgo/unsafe-effect-type-assertion": "error",
      "typescript/no-unnecessary-type-parameters": "error",
      "typescript/no-generated-empty-object-type": "error",

      "eslint/no-underscore-dangle": "error",
      "vitest/require-mock-type-parameters": "error",
      // `@effect/vitest`'s testers are test blocks too.
      "vitest/no-standalone-expect": [
        "error",
        { additionalTestBlockFunctions: ["it.effect", "it.live"] },
      ],
    },
    overrides: [
      // `@effect/vitest` marks `it` / `layer` unstable.
      {
        files: ["**/tests/**"],
        rules: {
          "effecttsgo/unstable-api-usage": "off",
        },
      },
      // The store's default submit is an Effect `HttpClient` over
      // `FetchHttpClient.layer`, and `effect/http/*` is marked unstable.
      // `message` mirrors the wire `FormState.message?` and is rendered
      // directly in markup. `#detachedData` claims `A` back from
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
    // tsgolint reads each file's nearest tsconfig.json; packages/svelte's maps
    // the core to `src/`, so `vp check` needs no `dist/`.
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
      // A `from: "dependencies"` edge does not traverse the root's own
      // devDependencies, so a new package adds itself to each list here.
      check: {
        command: "tsc -p tsconfig.json",
        dependsOn: [
          "@thomasfosterau/effect-forms#check",
          "@thomasfosterau/effect-forms-svelte#check",
        ],
        cache: false,
      },
      // Only the core has docgen: the Svelte examples need the Svelte compiler.
      docgen: {
        command: "echo 'docgen: every example compiled and ran'",
        dependsOn: ["@thomasfosterau/effect-forms#docgen"],
        cache: false,
      },
      ci: {
        command:
          "vp check && vp run check && vp run -r test:unit && vp run -r build && vp run docgen && pnpm audit --audit-level high",
        cache: false,
      },
      // One Istanbul map over every package, which `fallow audit` reads.
      "test:coverage": {
        command: "vp test run --coverage",
        dependsOn: [
          "@thomasfosterau/effect-forms#build",
          "@thomasfosterau/effect-forms-svelte#build",
        ],
        cache: false,
      },
      fallow: {
        command: "vp exec fallow --summary",
        cache: false,
      },
      // Run by the pre-commit hook.
      "fallow:audit": {
        command: "vp exec fallow audit --base origin/trunk --quiet",
        dependsOn: ["test:coverage"],
        cache: false,
      },
      "changeset:version": {
        command: "changeset version && vp fmt && pnpm install --lockfile-only",
        cache: false,
      },
    },
  },

  test: {
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
