---
"@thomasfosterau/effect-forms": patch
"@thomasfosterau/effect-forms-svelte": patch
---

Documentation fixes in the published READMEs and type declarations:

- `FormBuilder.filterOutputToFormIssues` is now marked `@deprecated`; import `Issues.filterOutputToFormIssues` instead. It is the same function, and the re-export still works.
- `Form.make` and `State.MakeFormStateOptions` document their contract and defaults in the hover; the svelte docs name the real `Form.make` rather than an internal alias, and `EntityForm` drops application-specific wording.
- The package READMEs gain Install and License sections, list every export (the core's `Command`; the Svelte root entry's `defineEntityForm`, `applyActionResult` and listeners), fix broken links and names of exports that do not exist, and the `effect-forms-svelte` README now carries the `/kit` guide.
