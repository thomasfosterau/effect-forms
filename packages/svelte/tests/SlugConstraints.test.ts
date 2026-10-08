import * as Schema from "effect/Schema";
import { FlatQuery } from "@thomasfosterau/effect-jsonapi";
import { Constraints } from "@thomasfosterau/effect-forms";
import { describe, expect, it } from "vite-plus/test";

// `FlatQuery.slug` (effect-jsonapi 0.16.3, built against effect 4.0.0) is built from
// `Schema.isBetweenLength(1, maxLength)` + `Schema.isPattern(SLUG_PATTERN)`.
// effect-forms keys the HTML attributes on those checks' representation ids
// (`effect/schema/isBetweenLength`, `effect/schema/isPattern`), so a slug
// field silently loses `minlength` / `maxlength` / `pattern` if an id drifts.
describe("constraintsFromSchema over effect-jsonapi's slug", () => {
  it("derives minlength, maxlength and pattern from FlatQuery.Slug", () => {
    const schema = Schema.Struct({ slug: FlatQuery.Slug });
    expect(Constraints.constraintsFromSchema(schema)).toEqual({
      slug: {
        required: true,
        minlength: 1,
        maxlength: 200,
        pattern: FlatQuery.SLUG_PATTERN.source,
      },
    });
  });

  it("honours a custom maxLength", () => {
    const schema = Schema.Struct({ slug: FlatQuery.slug({ maxLength: 64 }) });
    expect(Constraints.constraintsFromSchema(schema)).toEqual({
      slug: { required: true, minlength: 1, maxlength: 64, pattern: FlatQuery.SLUG_PATTERN.source },
    });
  });
});
