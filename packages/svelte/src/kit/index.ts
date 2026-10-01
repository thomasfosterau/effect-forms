/**
 * `@thomasfosterau/effect-forms-svelte/kit` — the SvelteKit-only half of the
 * bindings: derived form actions ({@link formAction}), JSON:API error
 * routing ({@link fieldFromPointer}, {@link jsonapiFailure}), the idempotent
 * client-id create retry ({@link idempotentCreate}), `$app/forms` glue
 * ({@link enhanceForm}), total readers over `PageProps["form"]`, and failure
 * routing for action-only routes ({@link withFailureParams}).
 *
 * Needs `@sveltejs/kit` (an optional peer of the package, required by this
 * entry). The JSON:API error shape is `@thomasfosterau/effect-jsonapi`'s
 * (an optional peer, used for its types only).
 *
 * @copyright Thomas Foster
 * @module effect-forms-svelte/kit
 */

export * from "./ActionRedirect.ts";
export * as CommandFailure from "./CommandFailure.ts";
export { jsonapiFailure } from "./CommandFailure.ts";
export * from "./Enhance.ts";
export * from "./FormAction.ts";
export * from "./FormStateReaders.ts";
export * from "./Pointer.ts";
