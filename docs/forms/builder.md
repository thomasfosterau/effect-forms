# Building a form incrementally

`Form.make` binds a hand-written `Schema.Struct`. When you'd rather compose a form field by field — reusing field groups, merging them, and attaching whole-form (cross-field) rules — reach for `FormBuilder`:

```ts
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Field, Form, FormBuilder } from "@thomasfosterau/effect-forms";

const signup = FormBuilder.empty
  .addField("email", Schema.String.check(Schema.isMinLength(3)))
  .addField("password", Schema.String.check(Schema.isMinLength(8)))
  .addField("confirm", Schema.String)
  .addField(Field.makeArrayField("tags", Schema.String)) // an array field
  .refine((v) =>
    v.password === v.confirm ? undefined : { path: ["confirm"], issue: "Passwords must match" },
  );

// Bind it exactly like a schema (defaults are derived when omitted):
const form = Form.fromBuilder(signup, { id: "signup" });
declare const request: Request; // the incoming submission
const state = await Effect.runPromise(form.validate(request));
```

`FormBuilder.buildSchema` collapses the builder into an ordinary `Schema.Struct` (array fields become `Schema.Array(item)`) with each synchronous `refine` applied as a struct-level check — so it decodes, derives constraints, and validates like any schema. `refineEffect` attaches an **asynchronous** whole-form rule (a uniqueness check against a service, say); Effect Schema has no effectful filter, so `Form.fromBuilder` runs those on the Effect validate path and folds their failures into the same error tree.

Back to [Validation and state](validation.md); all modules are listed in [Modules](modules.md).
