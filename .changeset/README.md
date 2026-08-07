# Changesets

This project uses [changesets](https://github.com/changesets/changesets) to
version releases and generate changelog entries.

```bash
bunx changeset
```

On `main`, `changesets/action` opens a **Version Packages** PR. After that PR
merges, the release workflow runs deterministic checks and creates the
application's `vX.Y.Z` Git tag and GitHub Release. This private application is
not published to npm.
