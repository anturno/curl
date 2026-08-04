# Changesets

This project uses [changesets](https://github.com/changesets/changesets) to
version releases and generate changelog entries.

```bash
npx changeset
```

On `main`, `changesets/action` opens a **Version Packages** PR. Merging that PR
tags a GitHub Release (see `bun run release` in `package.json`).
