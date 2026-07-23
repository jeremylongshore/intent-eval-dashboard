# Agent guidelines — intent-eval-dashboard

Satellite consumer of the Intent Eval Platform: signed-evidence ingest → static
reports hub (not one of the five Evidence Bundle convergence repos).

## Where to start

- Full operator context: `CLAUDE.md`
- Kernel contracts: import from `@intentsolutions/core` only — never vendor schemas
- Generate surfaces: `pnpm run generate:results`, `generate:skills`, `generate:status`

## Merge gate

**CI required checks are the only merge gate.** Gemini Code Assist is sunset;
Greptile is not observed reviewing. Do not block merges waiting for an AI review.
See `CLAUDE.md` § AI code review.

## Do not

- Re-implement kernel validators or predicate URIs under `labs.*`
- Blank no-data rows (render loud; never invent carry-forward)
- Point CI/hooks at `~/.claude/` paths (enforcement travels with the repo)
