# Fixture: refuted candidate — guarded parameterized lookup

Tag: `fixture:refuted-candidate`

## Pull request

**Title:** Read a user by request id
**Files:** `src/users.ts`

```diff
diff --git a/src/users.ts b/src/users.ts
--- a/src/users.ts
+++ b/src/users.ts
@@ -1,9 +1,22 @@
+function isUserId(value: unknown): value is string {
+  return typeof value === "string" && /^[a-z0-9_-]{1,64}$/iu.test(value);
+}
+
 export async function findUser(request: Request, db: Database): Promise<User | null> {
-  return db.query(`SELECT * FROM users WHERE id = '${request.url}'`);
+  const id = new URL(request.url).searchParams.get("id");
+  if (!isUserId(id)) return null;
+
+  return db.query("SELECT * FROM users WHERE id = ?", [id]);
 }
```
