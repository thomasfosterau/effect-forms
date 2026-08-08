/**
 * @copyright Thomas Foster
 *
 * `@thomasfosterau/effect-forms` — framework-neutral, Effect-native form
 * validation and state. A complete form feature set
 * (schema-driven validation, nested errors, posted-value retention, status
 * messages, native input constraints, a serialisable form snapshot) rebuilt on
 * Effect Schema, with no framework dependency. The Svelte bindings live in
 * `@thomasfosterau/effect-forms-svelte`.
 *
 * Modules are exposed as Effect-style namespaces — `import { Form, State } from
 * "@thomasfosterau/effect-forms"` then `Form.make(...)` / `State.make(...)`.
 *
 * @module effect-forms
 */

export * as Coerce from "./Coerce.ts";
export * as Command from "./Command.ts";
export * as Constraints from "./Constraints.ts";
export * as Errors from "./Errors.ts";
export * as Field from "./Field.ts";
export * as Form from "./Form.ts";
export * as FormBuilder from "./FormBuilder.ts";
export * as FormData from "./FormData.ts";
export * as Issues from "./Issues.ts";
export * as Mode from "./Mode.ts";
export * as Path from "./Path.ts";
export * as Result from "./Result.ts";
export * as State from "./State.ts";
export * as Validate from "./Validate.ts";
