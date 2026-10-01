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
  const tokens: string[] = [];
  let buffer = "";
  let inBracket = false;
  for (const char of name) {
    if (char === "[") {
      if (buffer !== "") tokens.push(buffer);
      buffer = "";
      inBracket = true;
    } else if (char === "]") {
      tokens.push(buffer);
      buffer = "";
      inBracket = false;
    } else if (char === "." && !inBracket) {
      if (buffer !== "") tokens.push(buffer);
      buffer = "";
    } else {
      buffer += char;
    }
  }
  if (buffer !== "") tokens.push(buffer);
  // A leading empty token can appear for names like `[0]`; drop it.
  return tokens.length > 1 && tokens[0] === "" ? tokens.slice(1) : tokens;
}

const isIndexToken = (token: string): boolean => token === "" || /^\d+$/.test(token);

/** Create the container a token should live in: array for index/append tokens. */
const makeContainer = (nextToken: string): Container => (isIndexToken(nextToken) ? [] : {});

const setOnContainer = (container: Container, token: string, value: unknown): void => {
  if (Array.isArray(container)) {
    if (token === "") container.push(value);
    else container[Number(token)] = value;
  } else {
    (container as Record<string, unknown>)[token] = value;
  }
};

const getFromContainer = (container: Container, token: string): unknown =>
  Array.isArray(container)
    ? container[Number(token)]
    : (container as Record<string, unknown>)[token];

/** Assign `value` deep into `root` along `tokens`, creating containers as needed. */
function assign(root: Container, tokens: string[], value: unknown): void {
  let node: Container = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];
    const nextToken = tokens[i + 1];
    let child = token === "" ? undefined : getFromContainer(node, token);
    if (child === undefined || typeof child !== "object" || child === null) {
      child = makeContainer(nextToken);
      setOnContainer(node, token, child);
    }
    node = child as Container;
  }
  const last = tokens[tokens.length - 1];
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
function* entriesOf(source: FormBodySource): Generator<readonly [string, unknown]> {
  if (
    typeof (source as Iterable<unknown>)[Symbol.iterator] === "function" &&
    !(source instanceof FormData) &&
    !(source instanceof URLSearchParams)
  ) {
    yield* source as Iterable<readonly [string, unknown]>;
    return;
  }
  for (const entry of (source as FormData | URLSearchParams).entries()) yield entry;
}

/**
 * Parse a form body into a nested object / array tree. Field names use dot or
 * bracket path notation (see {@link parseFieldPath}); repeated bare keys
 * become arrays; `File` values pass through. The result is ready to hand to
 * `Schema.decodeUnknown` with a schema whose leaves coerce the string inputs.
 */
export function formDataToObject(source: FormBodySource): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [name, value] of entriesOf(source)) {
    const tokens = parseFieldPath(name);
    if (tokens.length === 0) continue;
    assign(root, tokens, value);
  }
  return root;
}

/** Read and parse a `Request`'s form body. Errors (e.g. wrong content-type) reject. */
export async function requestToObject(request: Request): Promise<Record<string, unknown>> {
  const formData = await request.formData();
  return formDataToObject(formData);
}
