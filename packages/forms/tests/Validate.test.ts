import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { TestClock } from "effect/testing";
import { getError } from "../src/Errors.ts";
import {
  type AsyncFieldValidator,
  resolveFieldTrigger,
  runAsyncFieldValidator,
  runSyncFieldValidator,
  type SyncFieldValidator,
  validateValue,
  validateValueSync,
} from "../src/Validate.ts";

// Local Effect test runner — `@effect/vitest` (`it.effect`, its TestClock
// wiring) doesn't work against this repo's vitest alias (see
// `tests/helpers/effect.ts` at the repo root); provide `TestClock.layer()`
// explicitly per test instead.
const runTest = <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> => Effect.runPromise(effect);

const Field = Schema.String.check(Schema.isMinLength(3));

describe("validateValue", () => {
  it("succeeds with the decoded value", async () => {
    const result = await Effect.runPromise(validateValue(Field, "hello"));
    expect(result).toEqual({ valid: true, data: "hello" });
  });

  it("fails with errors and issues", async () => {
    const result = await Effect.runPromise(validateValue(Field, "hi"));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });
});

describe("validateValueSync", () => {
  const Struct = Schema.Struct({ email: Schema.String.check(Schema.isMinLength(3)) });

  it("validates synchronously", () => {
    expect(validateValueSync(Struct, { email: "a@b.co" })).toEqual({
      valid: true,
      data: { email: "a@b.co" },
    });
  });

  it("reports field errors synchronously", () => {
    const result = validateValueSync(Struct, { email: "x" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(getError(result.errors, ["email"])).toBeDefined();
    }
  });
});

describe("validateValue with a custom leaf formatter", () => {
  it("routes leaf issues through the provided formatter", async () => {
    const result = await Effect.runPromise(validateValue(Field, "x", () => "custom message"));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues[0]?.message).toBe("custom message");
    }
  });
});

describe("runSyncFieldValidator", () => {
  const passing: SyncFieldValidator<string> = () => undefined;
  const failing: SyncFieldValidator<string> = (value) =>
    value.length < 3 ? "Too short" : undefined;

  it("returns no issues when the validator passes", () => {
    expect(runSyncFieldValidator(passing, "anything")).toEqual([]);
  });

  it("folds a failing FilterOutput into a root-path FormIssue", () => {
    expect(runSyncFieldValidator(failing, "hi")).toEqual([{ path: [], message: "Too short" }]);
  });

  it("passes the current value to the validator", () => {
    const seen: string[] = [];
    runSyncFieldValidator((value: string) => {
      seen.push(value);
      return undefined;
    }, "ada");
    expect(seen).toEqual(["ada"]);
  });
});

describe("runAsyncFieldValidator", () => {
  it("runs immediately with no debounce (default)", () =>
    runTest(
      Effect.gen(function* () {
        const validator: AsyncFieldValidator<string> = (value) =>
          Effect.succeed(value === "taken" ? "Username taken" : undefined);
        const issues = yield* runAsyncFieldValidator(validator, "taken");
        expect(issues).toEqual([{ path: [], message: "Username taken" }]);
      }),
    ));

  it("waits the full debounce before running the validator", () =>
    runTest(
      Effect.gen(function* () {
        let calls = 0;
        const validator: AsyncFieldValidator<string> = (value) => {
          calls++;
          return Effect.succeed(value === "taken" ? "Taken" : undefined);
        };

        const fiber = yield* runAsyncFieldValidator(validator, "taken", 300).pipe(Effect.forkChild);

        yield* TestClock.adjust("299 millis");
        expect(calls).toBe(0);

        yield* TestClock.adjust("1 millis");
        const issues = yield* Fiber.join(fiber);
        expect(calls).toBe(1);
        expect(issues).toEqual([{ path: [], message: "Taken" }]);
      }).pipe(Effect.provide(TestClock.layer())),
    ));

  it("interrupting mid-debounce skips the validator entirely (true debounce)", () =>
    runTest(
      Effect.gen(function* () {
        let calls = 0;
        const validator: AsyncFieldValidator<string> = () => {
          calls++;
          return Effect.succeed(undefined);
        };

        const fiber = yield* runAsyncFieldValidator(validator, "x", 300).pipe(Effect.forkChild);
        yield* TestClock.adjust("100 millis");
        yield* Fiber.interrupt(fiber);

        expect(calls).toBe(0);
      }).pipe(Effect.provide(TestClock.layer())),
    ));

  it("latest-wins: interrupting an in-flight run before forking the next only keeps the last result", () =>
    runTest(
      Effect.gen(function* () {
        const started: string[] = [];
        const completed: string[] = [];
        const validator: AsyncFieldValidator<string> = (value) =>
          Effect.gen(function* () {
            started.push(value);
            yield* Effect.sleep("50 millis");
            completed.push(value);
            return undefined;
          });

        let fiber = yield* runAsyncFieldValidator(validator, "a", 100).pipe(Effect.forkChild);
        yield* TestClock.adjust("100 millis"); // "a"'s debounce elapses, its validator starts
        yield* Fiber.interrupt(fiber); // superseded before its own sleep resolves

        fiber = yield* runAsyncFieldValidator(validator, "b", 100).pipe(Effect.forkChild);
        yield* TestClock.adjust("150 millis"); // "b" debounces then completes
        yield* Fiber.join(fiber);

        expect(started).toEqual(["a", "b"]);
        expect(completed).toEqual(["b"]);
      }).pipe(Effect.provide(TestClock.layer())),
    ));

  it("interrupting mid-sleep-inside-validator aborts the validator (not just the debounce)", () =>
    runTest(
      Effect.gen(function* () {
        let sawCompletion = false;
        const validator: AsyncFieldValidator<string> = () =>
          Effect.gen(function* () {
            yield* Effect.sleep("1 second"); // e.g. an in-flight `fetch` wrapped as an Effect
            sawCompletion = true;
            return undefined;
          });

        const fiber = yield* runAsyncFieldValidator(validator, "x", 0).pipe(Effect.forkChild);
        yield* TestClock.adjust("500 millis");
        yield* Fiber.interrupt(fiber);
        yield* TestClock.adjust("1 second");

        expect(sawCompletion).toBe(false);
      }).pipe(Effect.provide(TestClock.layer())),
    ));

  it("propagates the value's FilterOutput array into multiple FormIssues", () =>
    runTest(
      Effect.gen(function* () {
        const validator: AsyncFieldValidator<string> = () =>
          Effect.succeed(["First problem", "Second problem"]);
        const issues = yield* runAsyncFieldValidator(validator, "x");
        expect(issues).toEqual([
          { path: [], message: "First problem" },
          { path: [], message: "Second problem" },
        ]);
      }),
    ));
});

describe("resolveFieldTrigger", () => {
  const onChange: SyncFieldValidator<string> = () => undefined;
  const onBlur: SyncFieldValidator<string> = () => undefined;
  const onChangeAsync: AsyncFieldValidator<string> = () => Effect.succeed(undefined);
  const onBlurAsync: AsyncFieldValidator<string> = () => Effect.succeed(undefined);

  it("picks onChange / onChangeAsync for the change trigger", () => {
    const resolved = resolveFieldTrigger(
      { onChange, onBlur, onChangeAsync, onBlurAsync, asyncDebounceMs: 300 },
      "change",
    );
    expect(resolved).toEqual({ sync: onChange, async: onChangeAsync, asyncDebounceMs: 300 });
  });

  it("picks onBlur / onBlurAsync for the blur trigger", () => {
    const resolved = resolveFieldTrigger(
      { onChange, onBlur, onChangeAsync, onBlurAsync, asyncDebounceMs: 300 },
      "blur",
    );
    expect(resolved).toEqual({ sync: onBlur, async: onBlurAsync, asyncDebounceMs: 300 });
  });

  it("resolves to undefined validators and a 0ms debounce when none are registered", () => {
    expect(resolveFieldTrigger(undefined, "change")).toEqual({
      sync: undefined,
      async: undefined,
      asyncDebounceMs: 0,
    });
  });

  it("resolves partially-declared validators independently", () => {
    expect(resolveFieldTrigger({ onChange }, "change")).toEqual({
      sync: onChange,
      async: undefined,
      asyncDebounceMs: 0,
    });
    expect(resolveFieldTrigger({ onChange }, "blur")).toEqual({
      sync: undefined,
      async: undefined,
      asyncDebounceMs: 0,
    });
  });
});
