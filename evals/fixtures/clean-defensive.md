# Fixture: clean — intentional defensive response validation

Tag: `fixture:clean-defensive`

## Pull request

**Title:** Reject malformed check responses
**Files:** `src/github-check.ts`

```diff
diff --git a/src/github-check.ts b/src/github-check.ts
--- a/src/github-check.ts
+++ b/src/github-check.ts
@@ -1,5 +1,20 @@
+type RecordLike = Record<string, unknown>;
+
+function isRecord(value: unknown): value is RecordLike {
+  return typeof value === "object" && value !== null && !Array.isArray(value);
+}
+
 export function parseCheckRun(body: unknown): { id: number; headSha: string } | null {
-  return body as { id: number; headSha: string };
+  if (!isRecord(body)) return null;
+
+  const id = body.id;
+  const headSha = body.head_sha;
+  if (
+    !Number.isSafeInteger(id) ||
+    id < 1 ||
+    typeof headSha !== "string" ||
+    !/^[0-9a-f]{40}$/iu.test(headSha)
+  ) {
+    return null;
+  }
+
+  return { id, headSha };
 }
```
