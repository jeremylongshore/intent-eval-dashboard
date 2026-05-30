# `site/` — Astro web dashboard

Reserved for the Astro implementation per DR-035 § 7 implementation directive 4 and amber-lighthouse plan Epic 1.3.

**Not yet implemented at v0.1.0 scaffolding (this commit).** Ships in Phase 1 Epic 1.3 (`bd_000-projects-puxu.3`):

- Astro 5.x, TypeScript-native, MD/MDX content collections
- Static-first build, interactive islands when needed
- `labs.intentsolutions.io/eval-sets/` route — versioned, lineage-tracked eval-set browser
- `/healthz` endpoint
- Deploy via partners.intentsolutions.io pattern (GHA → Tailscale OIDC → force-command SSH → `pnpm build` → rsync → Caddy reload)

Anti-goals enforced at this surface:

- **NO `gate-result/v1` rows render here at v0.1.0** — methodology + spec rendering only
- **NO predicate URIs declared at `labs.*`** — predicate URIs exclusively at `evals.intentsolutions.io`
- **NO aggregate PASS%** across heterogeneous predicates (CI lint enforced)
