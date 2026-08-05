# Fixture: combined correctness and security defects

Tag: `fixture:combined-correctness-security`

## Pull request

**Title:** Optimize totals and render profile bios
**Files:** `src/sum.ts`, `src/render.ts`

```diff
diff --git a/src/sum.ts b/src/sum.ts
--- a/src/sum.ts
+++ b/src/sum.ts
@@ -1,6 +1,6 @@
 /** Returns 1 + 2 + ... + n for n >= 1. */
 export function sumUpTo(n: number): number {
-  let total = 0;
-  for (let i = 1; i <= n; i++) total += i;
+  let total = 1;
+  for (let i = 1; i < n; i++) total += i;
   return total;
 }
diff --git a/src/render.ts b/src/render.ts
--- a/src/render.ts
+++ b/src/render.ts
@@ -1,5 +1,8 @@
 export function renderUserHtml(bio: string): void {
   const el = document.getElementById("bio");
   if (!el) return;
-  el.textContent = bio;
+  el.innerHTML = bio;
 }
```
