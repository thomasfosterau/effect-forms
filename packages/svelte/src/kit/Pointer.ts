/**
 * JSON Pointer → form field routing for a JSON:API error object's
 * `source.pointer`.
 *
 * @copyright Thomas Foster
 * @module effect-forms-svelte/kit/Pointer
 */

import type { Issues } from "@thomasfosterau/effect-forms";
import * as Arr from "effect/Array";
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
  pointer?: string,
): Option.Option<string> => {
  if (pointer === undefined || pointer === "") return Option.none();
  const [data, attributes, field] = pointer.split("/").slice(1).map(unescapeSegment);
  if (data !== "data" || attributes !== "attributes") return Option.none();
  return field === undefined || field === "" ? Option.none() : Option.some(field);
};

/**
 * The whole field path a JSON Pointer of the form `/data/attributes/<field>…`
 * names: every segment after `attributes`, with an integer segment read as an
 * array index (`/data/attributes/tags/0` → `["tags", 0]`,
 * `/data/attributes/author/name` → `["author", "name"]`). This is the path a
 * nested attribute's error is routed to in the form's error tree.
 *
 * `None` covers exactly the pointers {@link fieldFromPointer} answers `None`
 * for.
 *
 * @example
 * ```ts
 * import { pathFromPointer } from "@thomasfosterau/effect-forms-svelte/kit";
 *
 * pathFromPointer("/data/attributes/author/name"); // Option.some(["author", "name"])
 * pathFromPointer("/data/attributes/tags/0"); // Option.some(["tags", 0])
 * ```
 */
export const pathFromPointer = (
  // A JSON:API error object's `source?.pointer`, verbatim: absent is `undefined`.
  pointer?: string,
): Option.Option<Issues.FormPath> =>
  Option.map(fieldFromPointer(pointer), (field): Issues.FormPath => {
    const deeper = Arr.filter(Arr.drop((pointer ?? "").split("/"), 4), (s) => s !== "");
    return [field, ...Arr.map(deeper, indexOrKey)];
  });

/** A pointer segment below the field: an integer is an array index, anything else a (decoded) key. */
const indexOrKey = (segment: string): string | number =>
  /^\d+$/.test(segment) ? Number(segment) : unescapeSegment(segment);
