# Internal docs (not published)

Files here are for maintainers only. Most of this directory is **gitignored**
so roadmap, decision records, and drafts never ship with the public repo.

## Convention

| Path | Tracked? | Use for |
|------|----------|---------|
| `internal/README.md` | yes | this note |
| `internal/**` (everything else) | **no** | product decisions, roadmap, private notes |

## Suggested layout

```text
internal/
├── README.md          # tracked
├── product.md         # build contract / decision log (local)
├── roadmap.md         # phase notes, bets, open questions
└── scratch/           # throwaway drafts
```

Copy or keep `product.md` here; do not move it back under `docs/`.

Public documentation lives in [`docs/`](../docs/) and root files (`README.md`,
`CONTRIBUTING.md`, `SECURITY.md`, …).
