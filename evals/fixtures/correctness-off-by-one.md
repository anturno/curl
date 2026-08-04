# Fixture: correctness — off-by-one sum

Tag: `fixture:correctness`

## Pull request

**Title:** Faster sum helper  
**Files:** `src/sum.ts`

```diff
diff --git a/src/sum.ts b/src/sum.ts
--- a/src/sum.ts
+++ b/src/sum.ts
@@ -1,6 +1,8 @@
 /** Returns 1 + 2 + ... + n for n >= 1. */
 export function sumUpTo(n: number): number {
-  let total = 0;
-  for (let i = 1; i <= n; i++) total += i;
-  return total;
+  let total = 1;
+  for (let i = 1; i < n; i++) total += i;
+  return total;
 }
```
