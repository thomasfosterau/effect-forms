/**
 * Structured parsing of an HTML form body into a plain object the schema can
 * decode.
 *
 * Browsers flatten structured data into `name=value` pairs using bracket /
 * dot path notation (`author.name`, `author[name]`, `tags[0]`, `tags[]`).
 * {@link formDataToObject} reverses that into a nested object / array tree —
 * the framework-neutral step that turns a form body into structured data, before handing it
 * to a validator. Coercion (strings → numbers / booleans / dates) is then the
 * schema's job: decode the result with a schema built from coercing leaves
 * (`Schema.FiniteFromString`, `Schema.BooleanFromString`, the {@link
 * module:effect-forms/Coerce} helpers, …).
 *
 * `File` values pass through untouched; repeated bare keys collapse into an
 * array. The parser is total and never throws.
 *
 * @copyright Thomas Foster
 * @module effect-forms/FormData
 */

import * as Arr from "effect/Array";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";

/** Anything that can be parsed into a structured form object. */
export type FormBodySource =
  | FormData
  | URLSearchParams
  | Iterable<readonly [string, FormDataEntryValue | string]>;

type Container = Record<string, unknown> | unknown[];

/**
 * Split a flat field name into its path tokens. Supports dot notation
 * (`a.b`), bracket notation (`a[b]`, `a[0]`), and the trailing append form
 * (`a[]`, represented by an empty-string token). `"a[b][0]"` → `["a","b","0"]`;
 * `"a.b[]"` → `["a","b",""]`.
 */
export function parseFieldPath(name: string): string[] {
  const nonEmpty = (buffer: string): ReadonlyArray<string> => (buffer === "" ? [] : [buffer]);
  const scanned = Arr.reduce(
    Arr.fromIterable(name),
    { tokens: Arr.empty<string>(), buffer: "", inBracket: false },
    ({ tokens, buffer, inBracket }, char) => {
      if (char === "[") {
        return { tokens: [...tokens, ...nonEmpty(buffer)], buffer: "", inBracket: true };
      }
      if (char === "]") return { tokens: [...tokens, buffer], buffer: "", inBracket: false };
      if (char === "." && !inBracket) {
        return { tokens: [...tokens, ...nonEmpty(buffer)], buffer: "", inBracket };
      }
      return { tokens, buffer: buffer + char, inBracket };
    },
  );
  const tokens = [...scanned.tokens, ...nonEmpty(scanned.buffer)];
  // A leading empty token can appear for names like `[0]`; drop it.
  return tokens.length > 1 && tokens[0] === "" ? tokens.slice(1) : tokens;
}

const isIndexToken = (token: string): boolean => token === "" || /^\d+$/.test(token);

/** Create the container a token should live in: array for index/append tokens. */
const makeContainer = (nextToken: string): Container => (isIndexToken(nextToken) ? [] : {});

const setOnContainer = (container: Container, token: string, value: unknown): void => {
  if (Arr.isArray(container)) {
    if (token === "") container.push(value);
    else container[Number(token)] = value;
  } else {
    container[token] = value;
  }
};

const getFromContainer = (container: Container, token: string): unknown =>
  Arr.isArray(container) ? container[Number(token)] : container[token];

/** Assign `value` deep into `root` along `tokens`, creating containers as needed. */
function assign(root: Container, tokens: Arr.NonEmptyReadonlyArray<string>, value: unknown): void {
  const last = Arr.lastNonEmpty(tokens);
  // Walk every token but the last, descending into (or creating) the
  // container each one names; `tokens[i + 1]` is the token after `token`.
  const node = Arr.reduce(Arr.initNonEmpty(tokens), root, (parent, token, i): Container => {
    const child = token === "" ? undefined : getFromContainer(parent, token);
    if (Predicate.isObjectOrArray(child)) return child;
    const created = makeContainer(tokens[i + 1]);
    setOnContainer(parent, token, created);
    return created;
  });
  // A repeated bare key (no brackets) collapses into an array.
  if (last !== "" && !Array.isArray(node)) {
    const existing = getFromContainer(node, last);
    if (existing !== undefined) {
      const arr = Array.isArray(existing) ? existing : [existing];
      arr.push(value);
      setOnContainer(node, last, arr);
      return;
    }
  }
  setOnContainer(node, last, value);
}

/** Normalise a source into `[name, value]` entries. */
function entriesOf(source: FormBodySource): Iterable<readonly [string, unknown]> {
  if (source instanceof FormData || source instanceof URLSearchParams) return source.entries();
  return source;
}

/**
 * Parse a form body into a nested object / array tree. Field names use dot or
 * bracket path notation (see {@link parseFieldPath}); repeated bare keys
 * become arrays; `File` values pass through. The result is ready to hand to
 * `Schema.decodeUnknown` with a schema whose leaves coerce the string inputs.
 */
export function formDataToObject(source: FormBodySource): Record<string, unknown> {
  return Arr.reduce(entriesOf(source), Rec.empty<string, unknown>(), (root, [name, value]) => {
    const tokens = parseFieldPath(name);
    if (Arr.isReadonlyArrayNonEmpty(tokens)) assign(root, tokens, value);
    return root;
  });
}

/** Read and parse a `Request`'s form body. Errors (e.g. wrong content-type) reject. */
export async function requestToObject(request: Request): Promise<Record<string, unknown>> {
  const formData = await request.formData();
  return formDataToObject(formData);
}
