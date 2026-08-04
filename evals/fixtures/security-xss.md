# Fixture: security — XSS via innerHTML

Tag: `fixture:security`

## Pull request

**Title:** Show profile bio as HTML  
**Files:** `src/render.ts`

```diff
diff --git a/src/render.ts b/src/render.ts
--- a/src/render.ts
+++ b/src/render.ts
@@ -1,5 +1,8 @@
 export function renderUserHtml(bio: string): void {
   const el = document.getElementById("bio");
   if (!el) return;
-  el.textContent = bio;
+  // Render rich bios from the API
+  el.innerHTML = bio;
 }
```
