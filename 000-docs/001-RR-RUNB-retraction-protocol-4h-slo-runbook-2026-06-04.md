# Retraction Protocol — 4-Hour SLO Operator Runbook

| | |
|---|---|
| **Doc** | 001-RR-RUNB |
| **Date** | 2026-06-04 |
| **Bead** | puxu.10 (amber-lighthouse Epic 2.7) |
| **Capability** | INTEGRITY — take down a published attestation honestly |
| **SLO** | Retracted deep URL returns **410 Gone** in **< 4 hours** of an approved request |
| **Bindings** | DR-035 § 8 (GC closed-set · CISO evals-only · GC no-Hugo) |

## What this is

The retraction protocol is the platform's ability to **stop surfacing a published
attestation, honestly**. Sigstore / Rekor entries are append-only and **cannot be
un-logged** — so we do not pretend a retracted result never existed. Instead we:

1. record the retraction in an **append-only signed `retraction/v1` record**,
2. serve **410 Gone** at the retracted deep URL (not 404 — that would lie), and
3. serve a **tombstone** page disclosing the `reason_class`.

There is **NO site rebuild** in this path (GC binding). The retraction takes
effect via `git commit + rsync + caddy validate + systemctl reload caddy`.

## Hard bindings (cannot be silently overridden)

| # | Binding | Enforced by |
|---|---|---|
| 1 | **Closed-set `reason_class` only** — `partner-request`, `methodology-error`, `data-quality`, `consent-withdrawn`, `legal-hold`, `pre-publication-recall`. Open text is REJECTED. (GC) | `src/retraction/denylist.ts` validator (enum sourced from the kernel) + `denylist.test.ts` |
| 2 | **Predicate URI is `evals.intentsolutions.io/retraction/v1`** — NEVER `labs.*`. (CISO) | kernel `RETRACTION_V1_URI`; `statement.test.ts` asserts host `evals.` ; deploy.yml predicate-URI-at-labs scan |
| 3 | **No Hugo / no site rebuild** — `git commit + rsync + caddy reload`. (GC) | flat-file generators (`snippet.ts`, `tombstone.ts`); no build step in this path |

## Inputs and outputs

| Artifact | Path | Role |
|---|---|---|
| Denylist | `src/retraction/retractions.json` | Source of truth — the list of retracted subjects (one entry per retraction) |
| Validator | `src/retraction/denylist.ts` | Rejects open-text `reason_class`, subject-less entries, unsafe deep URLs, unknown fields |
| Signed record | `src/retraction/statement.ts` | Builds + kernel-validates the `retraction/v1` in-toto Statement; signing seam (sigstore keyless CI) |
| Caddy snippet | `deploy/retractions.snippet` (generated) | One `handle` block per deep URL → **410 + tombstone body** |
| Tombstone | `site/retracted/<slug>/index.html` (generated) | Public disclosure page (append-only honesty) |
| Generator | `pnpm run generate:retractions` | Regenerates snippet + tombstones from `retractions.json` |

A `retractions.json` of `[]` is a **valid** state: no-op snippet, zero tombstones.

## One denylist entry

```json
{
  "bundle_id": "0190b8e5-7c1a-7000-8000-000000000000",
  "deep_url_path": "/results/iec/0190b8e5/",
  "reason_class": "partner-request",
  "retracted_at": "2026-06-04T12:00:00Z",
  "note": "partner X requested removal 2026-06-03 (ref ticket #123)",
  "retracted_by": "ops@intentsolutions.io"
}
```

- **At least one** of `bundle_id` / `storage_key` / `content_hash` is REQUIRED
  (the signed subject must resolve to a concrete artifact). `deep_url_path` alone
  is NOT a subject.
- `deep_url_path` is the public results deep link that gets the 410 + tombstone.
  It is denylist-only (it is NOT carried into the signed predicate body).
- `note` and `retracted_by` are optional operator context. `note` maps to the
  predicate's optional free-text `reason` (operator context only — never parsed
  for decisions; `reason_class` is the machine signal).

## Operator flow (the < 4h SLO)

### 0. Triage / approval (out of band, before any file edit)

- A retraction request arrives (partner, GC, methodology review, data-quality
  incident, consent withdrawal, legal hold, or a pre-publication recall).
- Confirm it maps to **exactly one closed-set `reason_class`**. If it does not,
  it is not a retraction this protocol handles — escalate (a new reason class is
  a Class-1 ISEDC matter, not an ad-hoc edit).
- Identify the subject reference (`bundle_id` / `storage_key` / `content_hash`)
  and the public `deep_url_path`.

### 1. Add the entry to the denylist

Append the entry to `src/retraction/retractions.json`. Keep it append-only —
do not edit or remove prior entries (the platform's history is part of the
honesty contract).

### 2. Regenerate the snippet + tombstone

```bash
pnpm run generate:retractions
```

This:
- validates the whole denylist (FAILS CLOSED on any invalid entry — out-of-set
  `reason_class`, subject-less entry, bad JSON, unknown field — and regenerates
  nothing), then
- writes `deploy/retractions.snippet` (a `handle` 410 block per entry), and
- writes `site/retracted/<slug>/index.html` (one tombstone per entry).

### 3. Commit

```bash
git add src/retraction/retractions.json deploy/retractions.snippet site/retracted/
git commit -m "retract: <deep_url_path> (<reason_class>)"
git push   # or open a PR per branch policy
```

> The tombstones live under `site/` (public-honest disclosure). The snippet lives
> under `deploy/` (a Caddy config artifact, NOT served content).

### 4. Deploy — HUMAN-GATED VPS step (NOT in this repo's automation)

The tombstone files reach the VPS via the normal site deploy (`site/**` →
GitHub Actions → rsync). The **Caddy snippet** is a one-time-per-change manual
rsync + reload:

```bash
# On a tailnet device with VPS access (ssh intentsolutions):
rsync deploy/retractions.snippet intentsolutions:/etc/caddy/retractions.snippet

# On the VPS — set the site root env once in the labs block (first time only):
#   {$IEP_SITE_ROOT} = /srv/intent-eval-dashboard/site
#   import retractions.snippet     # inside the labs.intentsolutions.io block

caddy validate --config /etc/caddy/Caddyfile     # NEVER skip
sudo systemctl reload caddy                       # reload — NEVER restart
```

> **`reload`, never `restart`.** 24 production containers depend on Caddy on the
> VPS. `caddy validate` must pass before the reload.

### 5. Verify (< 4h from approval)

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://labs.intentsolutions.io/results/iec/0190b8e5/
# expect: 410

curl -s https://labs.intentsolutions.io/results/iec/0190b8e5/ | grep -i "chosen not to surface"
# expect: the disclosure sentence
```

The deep URL returns **410 Gone** with the tombstone body, **no site rebuild**.

## Why 410 (not 404, not 301)

- **404** would imply the resource never existed — a lie (it is in the Rekor
  transparency log).
- **301** would imply it moved — also false.
- **410 Gone** is the honest status: it existed and was intentionally withdrawn;
  clients and crawlers should drop it. The tombstone body discloses *why*.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `generate:retractions` exits 1 "INVALID — refusing to regenerate" | An entry has an out-of-set `reason_class`, no subject, bad JSON, or an unknown field | Fix the offending entry (the error names the index + field), re-run. Fail-closed by design — never a partial regeneration. |
| `caddy validate` fails | snippet not rsynced, or `{$IEP_SITE_ROOT}` not set, or `import` line missing | Re-rsync; confirm the labs block sets the env + imports the snippet |
| Deep URL still 200 after reload | tombstone not yet deployed (site rsync pending) or wrong `deep_url_path` | Confirm `site/retracted/<slug>/` deployed; confirm the path matches the live results URL exactly |
| Deep URL 404 (not 410) | `handle` matcher path mismatch (trailing slash) | The generator matches both slash + non-slash forms; confirm the entry's `deep_url_path` matches the published URL |

## Append-only honesty

A retraction does **not** delete the original attestation. The original row stays
in the Rekor transparency log forever. The `retraction/v1` record is an
**additional** append-only signed statement that we have chosen not to surface
the subject, and why. The tombstone is the human-readable face of that record.

## Signing

The `retraction/v1` Statement is built + kernel-validated locally
(`src/retraction/statement.ts`). Actual **sigstore keyless signing** (OIDC →
Fulcio → DSSE → Rekor) is the same CI path used elsewhere on the platform, wired
behind the `RetractionSigner` interface. The default `unsignedSigner` returns the
canonical payload with an explicit `signed: false` marker — it never fabricates a
signature, cert, or Rekor index. Wiring the production signer into CI is tracked
separately (the predicate body runs in `sigstore_staging` until production-Rekor
unlock per DR-010 Q3).
