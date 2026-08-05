# Fixture: real defect — authorization regression

Tag: `fixture:real-defect`

## Pull request

**Title:** Simplify resource deletion permissions
**Files:** `src/permissions.ts`

```diff
diff --git a/src/permissions.ts b/src/permissions.ts
--- a/src/permissions.ts
+++ b/src/permissions.ts
@@ -1,7 +1,7 @@
 export function canDelete(user: User, resource: Resource): boolean {
-  return user.role === "admin" || user.id === resource.ownerId;
+  return user.role === "admin" || user.role === "viewer" || user.id === resource.ownerId;
 }

 export async function deleteResource(user: User, resource: Resource): Promise<void> {
   if (!canDelete(user, resource)) throw new ForbiddenError();
   await storage.delete(resource.id);
 }
```
