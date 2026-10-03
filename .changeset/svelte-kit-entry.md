---
"@thomasfosterau/effect-forms-svelte": minor
---

Add the `@thomasfosterau/effect-forms-svelte/kit` entry, the SvelteKit form-action glue the consuming applications each wrote by hand:

- `formAction` / `runFormAction`: validate a submission against an effect-forms form, run a Promise or Effect command, and answer `redirect(303)`, `fail(status, { form })` or `fail(500, { message })`. A command failure's JSON:API error objects are routed onto fields by `source.pointer`. Options cover `classify`, `redact`, `unrecognised: "throw"`, and the idempotent client-id retry.
- `fieldFromPointer`, `idempotentCreate`, and `CommandFailure` / `jsonapiFailure`. The error shape is `@thomasfosterau/effect-jsonapi`'s `Document.ErrorObject`, an optional, type-only peer.
- `enhanceForm`: spreadable `<form>` props on `$app/forms` `enhance`. `$app/forms` stays a SvelteKit virtual.
- `formStateOf` / `issuesFor` / `rootIssuesOf` / `valueOf`: total readers over `PageProps["form"]`.
- `userFixableMessage` / `withFailureParams`, for action-only routes.

`@sveltejs/kit` (`^3.0.0`) and `@thomasfosterau/effect-jsonapi` (`>=0.16.0`) are new optional peers. The root entry is unchanged.
