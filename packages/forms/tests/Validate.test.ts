import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { assert, describe, expect } from "vite-plus/test";
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

// `it.effect` runs each test as its own program with a fresh `TestClock`
// (starting at zero), so the debounce tests below advance time explicitly.

const Field = Schema.String.check(Schema.isMinLength(3));

describe("validateValue", () => {
  it.effect("succeeds with the decoded value", () =>
    Effect.gen(function* () {
      const result = yield* validateValue(Field, "hello");
      expect(result).toEqual({ isValid: true, data: "hello" });
    }),
  );

  it.effect("fails with errors and issues", () =>
    Effect.gen(function* () {
      const result = yield* validateValue(Field, "hi");
      expect(result.isValid).toBe(false);
      assert(!result.isValid);
      expect(result.issues.length).toBeGreaterThan(0);
    }),
  );
});

describe("validateValueSync", () => {
  const Struct = Schema.Struct({ email: Schema.String.check(Schema.isMinLength(3)) });

  it("validates synchronously", () => {
    expect(validateValueSync(Struct, { email: "a@b.co" })).toEqual({
      isValid: true,
      data: { email: "a@b.co" },
    });
  });

  it("reports field errors synchronously", () => {
    const result = validateValueSync(Struct, { email: "x" });
    expect(result.isValid).toBe(false);
    assert(!result.isValid);
    expect(Option.isSome(getError(result.errors, ["email"]))).toBe(true);
  });
});

describe("validateValue with a custom leaf formatter", () => {
  it.effect("routes leaf issues through the provided formatter", () =>
    Effect.gen(function* () {
      const result = yield* validateValue(Field, "x", () => "custom message");
      expect(result.isValid).toBe(false);
      assert(!result.isValid);
      expect(result.issues[0]?.message).toBe("custom message");
    }),
  );
});

const passing: SyncFieldValidator<string> = () => undefined;
const failing: SyncFieldValidator<string> = (value) => (value.length < 3 ? "Too short" : undefined);

const takenValidator: AsyncFieldValidator<string> = (value) =>
  Effect.succeed(value === "taken" ? "Username taken" : undefined);

const multiIssueValidator: AsyncFieldValidator<string> = () =>
  Effect.succeed(["First problem", "Second problem"]);

const onChange: SyncFieldValidator<string> = () => undefined;
const onBlur: SyncFieldValidator<string> = () => undefined;
const onChangeAsync: AsyncFieldValidator<string> = () => Effect.succeed(true);
const onBlurAsync: AsyncFieldValidator<string> = () => Effect.succeed(true);

describe("runSyncFieldValidator", () => {
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
  it.effect("runs immediately with no debounce (default)", () =>
    Effect.gen(function* () {
      const issues = yield* runAsyncFieldValidator(takenValidator, "taken");
      expect(issues).toEqual([{ path: [], message: "Username taken" }]);
    }),
  );

  it.effect("waits the full debounce before running the validator", () =>
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
    }),
  );

  it.effect("interrupting mid-debounce skips the validator entirely (true debounce)", () =>
    Effect.gen(function* () {
      let calls = 0;
      const validator: AsyncFieldValidator<string> = () => {
        calls++;
        return Effect.succeed(true);
      };

      const fiber = yield* runAsyncFieldValidator(validator, "x", 300).pipe(Effect.forkChild);
      yield* TestClock.adjust("100 millis");
      yield* Fiber.interrupt(fiber);

      expect(calls).toBe(0);
    }),
  );

  it.effect(
    "latest-wins: interrupting an in-flight run before forking the next only keeps the last result",
    () =>
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
      }),
  );

  it.effect(
    "interrupting mid-sleep-inside-validator aborts the validator (not just the debounce)",
    () =>
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
      }),
  );

  it.effect("propagates the value's FilterOutput array into multiple FormIssues", () =>
    Effect.gen(function* () {
      const issues = yield* runAsyncFieldValidator(multiIssueValidator, "x");
      expect(issues).toEqual([
        { path: [], message: "First problem" },
        { path: [], message: "Second problem" },
      ]);
    }),
  );
});

describe("resolveFieldTrigger", () => {
  it("picks onChange / onChangeAsync for the change trigger", () => {
    const resolved = resolveFieldTrigger("change", {
      onChange,
      onBlur,
      onChangeAsync,
      onBlurAsync,
      asyncDebounceMs: 300,
    });
    expect(resolved).toEqual({
      sync: Option.some(onChange),
      async: Option.some(onChangeAsync),
      asyncDebounceMs: 300,
    });
  });

  it("picks onBlur / onBlurAsync for the blur trigger", () => {
    const resolved = resolveFieldTrigger("blur", {
      onChange,
      onBlur,
      onChangeAsync,
      onBlurAsync,
      asyncDebounceMs: 300,
    });
    expect(resolved).toEqual({
      sync: Option.some(onBlur),
      async: Option.some(onBlurAsync),
      asyncDebounceMs: 300,
    });
  });

  it("resolves to no validators and a 0ms debounce when none are registered", () => {
    expect(resolveFieldTrigger("change")).toEqual({
      sync: Option.none(),
      async: Option.none(),
      asyncDebounceMs: 0,
    });
  });

  it("resolves partially-declared validators independently", () => {
    expect(resolveFieldTrigger("change", { onChange })).toEqual({
      sync: Option.some(onChange),
      async: Option.none(),
      asyncDebounceMs: 0,
    });
    expect(resolveFieldTrigger("blur", { onChange })).toEqual({
      sync: Option.none(),
      async: Option.none(),
      asyncDebounceMs: 0,
    });
  });
});
