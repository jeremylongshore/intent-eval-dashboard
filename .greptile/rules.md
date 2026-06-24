# Greptile reviewer orientation — intent-eval-dashboard

You are reviewing `intent-eval-dashboard`. Before flagging anything, ground
yourself in this orientation and in `CLAUDE.md` (the repo's source of truth for
the load-bearing invariants below). The structured per-file rules live in
`.greptile/config.json`; the grounding docs are listed in `.greptile/files.json`.
This file is the prose brief for a principal reviewer.

## (a) Platform context

This repo is the 6th member of the **Intent Eval Platform** — an Intent Solutions
ecosystem of six independently-versioned repos that converge via a single shared
**Evidence Bundle** schema. The other five:

- `intent-eval-core` — the canonical contracts kernel, published as
  `@intentsolutions/core` (TypeScript types + JSON Schemas + Zod validators +
  predicate-URI constants for the platform's domain entities).
- `intent-eval-lab` — methodology, Decision Records (DR-035 governs this repo),
  and the Blueprints that act as the platform constitution.
- `intent-audit-harness` — deterministic gates + emit-evidence.
- `j-rig-skill-binary-eval` — behavioral eval + provider adapters.
- `intent-rollout-gate` — the GitHub Action that consumes Evidence Bundles for
  ship / no-ship decisions.

**This repo is the PUBLIC reports dashboard at `labs.intentsolutions.io`.** It
renders three things: eval-set methodology, VERIFIED signed Evidence Bundles, and
`gate-result/v1` rows produced by the five platform repos (plus selected external
consumers). It is a *consumer* of the platform, not a producer of new evidence.

**Anti-corruption layer (Blueprint A § 1.2 principle 10).** This repo CONSUMES the
kernel `@intentsolutions/core` exactly like an external integrator would. Canonical
types, JSON Schemas, Zod validators, and predicate-URI constants are always
IMPORTED from the kernel — never vendored, copied, re-declared, or forked into this
repo. A locally-defined `EvidenceBundle` / `gate-result` / `retraction` type or
schema, or a hardcoded predicate-URI literal where a kernel constant exists, is a
review finding.

## (b) The DR-035 § 8 HARD REFUSALS (load-bearing — each tied to a council seat)

These are ratified, non-negotiable bindings from ISEDC Session 8 (DR-035). A change
that violates one is not a style nit — it is a refusal that requires a formal
successor Decision Record to override. Treat any code that even *approaches* one of
these as high-severity.

1. **No predicate URIs at `labs.*`** (CISO). Predicate URIs, in-toto predicate
   identifiers, attestation predicate IDs, OTel attribute namespaces, and schema
   `$id`s that name a predicate live EXCLUSIVELY at `evals.intentsolutions.io` —
   NEVER at `labs.*` / `labs.intentsolutions.io`. This dashboard serves `labs.*` and
   declares no predicate URIs of its own; it only renders methodology + signed
   bundles. A predicate URI pointed at a `labs.*` host is a refusal.

2. **C3 — no aggregate PASS% across heterogeneous predicates** (CTO + CMO + VP
   DevRel triple-refusal — the hard integrity binding). NEVER emit an aggregate
   PASS%, an "X of N" count, or an "X%" figure computed ACROSS two or more distinct
   predicate URIs. Per-predicate counts only (a single predicate URI). Any
   `X/N pass` or `X% pass` spanning heterogeneous predicates is a refusal. Do not
   weaken `src/results/c3-scan.ts`, `scripts/lint-no-aggregate-pass.ts`, or the C3
   CI gate to make a test pass.

3. **No partner-implicated bundle without written consent** (GC). A
   partner-implicated Evidence Bundle may not be published to the public origin
   absent affirmative written consent. Tier-2 (partner-implicated) rows default to
   internal-only; public exposure requires a per-partner consent clause. The public
   visibility gate (`src/results/visibility.ts`) must FAIL CLOSED to Tier 2 — never
   default-publish a partner-implicated row.

4. **No basicauth on the public origin** (VP DevRel). Operator-internal surfaces are
   tailnet-only and gated by **Tailscale identity** — never by basicauth. Do not add
   basicauth directives, HTTP Basic credential checks, or password gates to any
   public-origin config, generator, or Caddy snippet this repo emits. (Note the one
   sanctioned exception, per successor DR-040: the *internal testing dashboard* at
   `internal.intentsolutions.io` under `site-internal/internal/testing/` is
   basicauth-gated — that is a distinct non-public hostname, not the public
   `labs.*` origin.)

5. **No GCP object storage** (CISO, GCP-exodus binding). Content is content-addressed
   onto local Contabo disk, migrating to Backblaze B2 at the 12-month / 100GB
   trigger. Refuse any Google Cloud Storage / GCS client, `gs://` URI,
   `@google-cloud/storage` import, or `storage.googleapis.com` dependency for
   bundle / artifact persistence.

6. **No render-from-manifest without re-verification** (CTO + CISO independent
   refusals — see contract in (c)). Every ingest worker re-verifies at INGEST time;
   the renderer consumes only the verify-before-render seam
   (`src/ingest/renderer.ts` → `src/results/row-model.ts`), never a raw manifest.

7. **Absence is shown loudly, never carried forward** (Gregg / CMO C4). An hour or
   row with no verified data is `no-data` and is colored as loudly as `fail`.
   `no-data` is NEVER carried forward, inferred, back-filled, blanked, or treated as
   a pass. A bucket's kind is `no-data` IFF its row count is 0 — there must be no
   carry-forward code path (`src/freshness/bucket-model.ts`,
   `src/results/render-html.ts`). A `fail` severity is never masked by a `pass`.

8. **No production-system paging SLO beyond the 7-day-silence threshold** (CFO). The
   only paging trigger is a source silent > 7 days; the only push protocol is ntfy
   (no PagerDuty / Opsgenie / Slack / SMS). No uptime / availability SLA or "N nines"
   claim may appear in public output (`scripts/check-uptime-claims.ts` enforces this).
   The public commitment is exactly "best-effort, single-operator, see /status for
   liveness". Do not add latency / error-rate pagers or weaken `src/alerting/`.

## (c) The verify-before-render ingest contract (DR-035 B1)

This is the security heart of the repo. Before ANY row renders, the per-repo ingest
worker MUST, row by row, in order:

1. Verify the OIDC issuer + subject + `workflow_ref:` claim against the pinned
   per-repo allowlist (`ingest/pinned-subjects.json`).
2. Verify the Rekor inclusion proof.
3. Verify the DSSE signature.
4. Validate the bundle against the kernel-pinned `@intentsolutions/core`
   EvidenceBundle schema.

On ANY failure the worker CRASHES with a structured reason and writes nothing; the
supervisor records `last_known_good_stale_since` and the renderer keeps serving the
PRIOR good snapshot with a visible `stale_since` badge. There are no no-op
verification stubs — if something cannot be verified for real, the worker fails
closed. The supervision tree (`src/ingest/`, `src/supervision/`) implements genuine
Erlang/OTP semantics; both the production sigstore verifier and the test-injected
offline verifier perform REAL cryptography.

## (d) What a high-quality review catches here

Flag, with high severity, any change that introduces:

- A predicate URI, in-toto predicate identifier, OTel namespace, or schema `$id`
  pointed at a `labs.*` host (should be `evals.*`).
- A cross-predicate aggregate PASS% / "X of N" / "X%" spanning more than one
  predicate URI — or a weakening of the C3 scanner / gate that would let one through.
- basicauth (or any password / HTTP-Basic gate) added to the public `labs.*` origin,
  generator, or Caddy snippet (the tailnet operator views use Tailscale identity).
- A render path that skips re-verification — rendering from a raw manifest, or any
  path that reaches the renderer without passing the 4-check ingest contract.
- A carried-forward / back-filled / blanked `no-data` bucket, or `no-data` treated
  as (or masked by) a pass — anything that makes absence look like success.
- A vendored / copied / locally-redeclared kernel type, schema, validator, or
  predicate-URI literal instead of an import from `@intentsolutions/core`.
- GCP object storage (`gs://`, `@google-cloud/storage`, `storage.googleapis.com`)
  for bundle / artifact persistence.
- A paging trigger other than "source silent > 7 days", a non-ntfy pager, or an
  uptime / availability / "N nines" SLA claim in public output.
- Output written from an internal generator into the public `site/` origin (internal
  output belongs only under `site-internal/`).

When in doubt about whether something is load-bearing, read `CLAUDE.md` — every
refusal above is documented there with its originating council seat.
