# `site/` — Static HTML pages

Source for the public dashboard at `labs.intentsolutions.io`.

## v0.1.0: single-file HTML

Per acting-head decision 2026-05-30 (recorded in `~/.claude/plans/intent-solutions-lab-reports-amber-lighthouse.md` § 3 Epic 1.3):

- One self-contained `.html` file per eval-set page, Claude-generated
- One shared `/style.css` to avoid layout duplication
- **No build step.** Deploy is pure rsync of `.html` files to `/srv/intent-eval-dashboard/`
- Outsiders can `curl` + `view-source` and get the entire page inspectable

### Why this format

- Eval-set pages are content-first methodology documents — HTML is the right format for documents (Karpathy "eval-set IS the spec")
- Plays to Claude's documented single-file HTML strength
- "No JS framework hidden complexity" — Gregg + CISO framing
- Zero build infra at v0.1.0: no pnpm install for the site itself, no Astro version churn, no lockfile drift

## Phase 2: Astro adopted

When interactive surfaces arrive — results browser (`puxu.6`) + freshness strip (`puxu.7`) — Astro takes over. Single-file HTML pages migrate cleanly to Astro layouts at that point. Migration is mechanical (paste body into `.astro` template, move metadata into typed frontmatter).

## Layout

```
site/
├── style.css                              # shared across all pages
├── index.html                             # /labs.intentsolutions.io/ root
├── healthz.html                           # /healthz endpoint (served by Caddy)
├── eval-sets/
│   ├── index.html                         # /eval-sets/ listing
│   ├── <slug-1>/index.html                # /eval-sets/<slug-1>/ — one eval-set
│   └── <slug-2>/index.html
└── methodology/
    └── index.html
```

## Hard constraints enforced at this surface

- **NO `gate-result/v1` rows render here at v0.1.0** — methodology + spec rendering only
- **NO predicate URIs declared at `labs.*`** — predicate URIs exclusively at `evals.intentsolutions.io`
- **NO aggregate PASS%** across heterogeneous predicates (CI lint enforced when Phase 2 ingest arrives)

## Generation

Pages are produced one of two ways:

1. **Claude-generated** via prompting at puxu.3 work-time (matches the single-file HTML strength)
2. **Hand-edited** by Jeremy for content-critical surfaces

Either way, the output is reviewed before commit. Both methods produce the same artifact: a self-contained `.html` file with inline metadata.
