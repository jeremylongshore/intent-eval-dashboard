# Security Policy

## Reporting a Vulnerability

Report security issues privately via [GitHub Private Security Advisory](https://github.com/jeremylongshore/intent-eval-dashboard/security/advisories/new) or email `jeremy@intentsolutions.io` with subject prefix `[SECURITY intent-eval-dashboard]`.

Please include:

- A description of the issue
- Steps to reproduce
- Affected versions / commits
- Any proof-of-concept code (if applicable)

We aim to acknowledge within 72 hours.

## Supported Versions

`intent-eval-dashboard` follows semantic versioning. Pre-1.0.0 means surface is unstable and only the latest release is supported for security fixes.

## Scope

In scope for this repository:

- Source code and CI workflows in this repo
- The deployed surface at `labs.intentsolutions.io`
- The published `dashboard-render/v1` predicate URI (when sequenced; lives at `evals.intentsolutions.io/dashboard-render/v1`, NEVER at `labs.*`)
- The retraction protocol + `retraction/v1` predicate

Out of scope (report to the relevant repo):

- `@intentsolutions/core` schema/validator bugs → `intent-eval-core`
- Audit-harness gate bugs → `intent-audit-harness`
- Skill-eval issues → `j-rig-skill-binary-eval`
- Rollout-gate Action bugs → `intent-rollout-gate`

## Cryptographic posture

- Evidence Bundles ingested into this dashboard are DSSE-wrapped, in-toto Statement v1, Rekor-anchored
- Every ingest verifies signature + Rekor inclusion proof + schema before render (DR-035 § 4 B1 binding)
- The dashboard itself sequences "sign-your-own-homework" attestation to v0.2.0+ pending second independent verifier (DR-035 § 4 B3)
- Storage is content-addressed; upstream tag-deletion or force-push does not invalidate dashboard's local copy

## What is NOT a vulnerability

- Stale data displayed with a visible `stale_since` badge (this is the correct behavior — see DR-035 § 4 C4)
- A retracted bundle showing as a tombstone page instead of 404 (correct behavior per DR-035 § 4 B4)
- The absence of an aggregate "PASS%" headline (intentional per DR-035 § 4 C3)
- The absence of basicauth on the public origin for operator views (correct per DR-035 § 4 C1; operator views are tailnet-only)
