/**
 * @copyright Thomas Foster
 *
 * `@thomasfosterau/effect-forms-svelte` — Svelte 5 (runes) bindings for
 * `@thomasfosterau/effect-forms`. {@link createForm} is the entry point:
 * a reactive form store with progressive-enhancement `enhance`, tainted
 * tracking, lifecycle events, and optional client-side validation against the
 * same Effect Schema the server uses.
 *
 * @module effect-forms-svelte
 */

export * from "./ClientValidate.ts";
export * from "./EnhanceCore.ts";
export * from "./FormStore.svelte.ts";
export * from "./Tainted.ts";
