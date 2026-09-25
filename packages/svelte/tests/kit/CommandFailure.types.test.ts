/**
 * The error-object shape is effect-jsonapi's, not a copy: pin that the kit's
 * `ErrorObject` IS `Document.ErrorObject.Type` (and not `any`), and that the
 * fixtures' stand-in errors produce values it accepts. Checked by `vp check`
 * (type-aware lint + type-check); the runtime assertions are trivial.
 */
import type { Document } from "@thomasfosterau/effect-jsonapi";
import { describe, expectTypeOf, it } from "vite-plus/test";
import type { CommandFailure } from "../../src/kit/index.ts";
import type { ErrorObject as FixtureErrorObject } from "./fixtures.ts";

describe("CommandFailure.ErrorObject", () => {
  it("is effect-jsonapi's Document.ErrorObject", () => {
    expectTypeOf<CommandFailure.ErrorObject>().toEqualTypeOf<typeof Document.ErrorObject.Type>();
    expectTypeOf<CommandFailure.ErrorObject>().not.toBeAny();
  });

  it("accepts what the test fixtures raise", () => {
    expectTypeOf<typeof FixtureErrorObject.Type>().toExtend<CommandFailure.ErrorObject>();
  });
});
