---
"@thomasfosterau/effect-forms-svelte": patch
---

`formStateOf` / `valueOf` (`/kit`) no longer repopulate a field from a posted `File` / `Blob`: a file input can't be refilled, and the value used to read back as `[object File]`. The field falls back like a posted `null`.
