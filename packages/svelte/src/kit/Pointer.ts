/**
 * @copyright Thomas Foster
 *
 * JSON Pointer → form field routing for a JSON:API error object's
 * `source.pointer`.
 *
 * @module effect-forms-svelte/kit/Pointer
 */

import * as Option from "effect/Option";

// RFC 6901 escapes: `~1` → `/`, `~0` → `~` (in that order).
const unescapeSegment = (segment: string): string =>
  segment.replace(/~1/g, "/").replace(/~0/g, "~");

/**
 * The field a JSON Pointer of the form `/data/attributes/<field>…` names.
 * Deeper segments are ignored: the form issue layer keys by the top-level
 * field name.
 *
 * `None` covers every non-field pointer, including an absent one, a pointer
 * outside `/data/attributes`, and an empty field segment
 * (`/data/attributes/`), so a caller can read the result as a plain `Option`
 * with no extra `""` test.
 *
 * @example
 * ```ts
 * import { fieldFromPointer } from "@thomasfosterau/effect-forms-svelte/kit";
 *
 * fieldFromPointer("/data/attributes/name"); // Option.some("name")
 * fieldFromPointer("/data/relationships/author"); // Option.none()
 * ```
 */
export const fieldFromPointer = (
  // A JSON:API error object's `source?.pointer`, verbatim: absent is `undefined`.
  pointer: string | undefined,
): Option.Option<string> => {
  if (pointer === undefined || pointer === "") return Option.none();
  const [data, attributes, field] = pointer.split("/").slice(1).map(unescapeSegment);
  if (data !== "data" || attributes !== "attributes") return Option.none();
  return field === undefined || field === "" ? Option.none() : Option.some(field);
};
