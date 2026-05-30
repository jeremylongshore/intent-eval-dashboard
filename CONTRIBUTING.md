# Contributing to `intent-eval-dashboard`

Thanks for considering a contribution.

## Quick start

```bash
git clone https://github.com/jeremylongshore/intent-eval-dashboard.git
cd intent-eval-dashboard
pnpm install
pnpm exec audit-harness verify     # harness self-check
```

## Hard refusal triggers (read DR-035 § 8 before proposing changes)

Some changes will be rejected at PR review regardless of how well-implemented they are. The full list is in DR-035 § 8; the most common ones to know:

- **No predicate URIs at `labs.*`** — predicate URIs live at `evals.intentsolutions.io` exclusively
- **No aggregate `<X>/<N> pass` or `<X>% pass`** across heterogeneous predicates (CI lint enforced)
- **No basicauth on public origin** for operator views — operator-internal goes tailnet-only
- **No GCP object storage** — content-addressed Evidence Bundles go to local Contabo disk → Backblaze B2 at 12-month or 100 GB trigger
- **No render-from-manifest without re-verification** at ingest

If a proposed change conflicts with DR-035, the right path is a successor DR ratified by ISEDC — not a CONTRIBUTING.md workaround.

## Conventional commits

```
feat: short description
fix: short description
docs: short description
chore: short description
test: short description
refactor: short description
```

## Sign-off (DCO)

All commits require sign-off:

```bash
git commit -s -m "feat: add the thing"
```

This adds a `Signed-off-by:` line stating you have the right to contribute the change under the project license (Apache 2.0).

## Partner-name discipline

Per DR-004 S1Q2 (binding across all IEP repos), use vendor-generic language in any commit message, code comment, doc, or PR title that touches partner-implicated work. Specific partner names are forbidden in this repo. The CI grep gate enforces.

If you need to reference a specific partner internally (e.g., in a bead description), use the bd workspace at `~/000-projects/.beads/` — beads are local-only and not subject to the discipline.

## PR review

- Required CI checks must pass (partner-name guard, harness verify, schema codegen clean, C3 aggregate-PASS% lint, predicate-URI-at-labs scan)
- Advisory CI checks (markdownlint, Vale, Prettier) may fail without blocking merge — but fixing is appreciated

## Reporting bugs

Use the [issue tracker](https://github.com/jeremylongshore/intent-eval-dashboard/issues). For security issues, see [SECURITY.md](SECURITY.md).

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Be respectful.
