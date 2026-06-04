# Ingest pipeline + supervision tree

> bead `puxu.5` · amber-lighthouse **Epic 2.2** · **DR-035 § 4.B** (Armstrong's supervision spec)

This module is the **SECURITY-CRITICAL** ingest infrastructure for the public
dashboard at `labs.intentsolutions.io`. It verifies signed evidence **before**
it can ever be rendered publicly, and supervises the per-repo ingest workers
with real Erlang/OTP-style semantics.

## The hard binding: verify-before-render (fail-closed)

A CTO + CISO independent hard refusal binds (DR-035 § 8):

> **"render-without-reverify" is forbidden.**

Every ingest worker re-verifies the pinned OIDC identity, the Rekor inclusion
proof, the DSSE signature, and the kernel schema at **ingest time** — never
trusting a manifest at render time. On **any** verification failure the worker
**crashes** with a structured reason and writes **nothing** to the staging area.
The renderer then keeps serving the **prior good snapshot** for that repo (with a
visible `stale_since` badge) and never the unverified input.

There are **no no-op verification stubs**. If something cannot be verified for
real, the worker fails closed (crashes); it does not pass through.

## Supervision tree (DR-035 § 4.B)

```
deploy_supervisor          one_for_one* , restart=permanent
├── ingest_supervisor      one_for_one,  max_restarts=N per repo per hour
│   ├── ingest_worker:iec   transient
│   ├── ingest_worker:iel   transient
│   ├── ingest_worker:iah   transient
│   ├── ingest_worker:iaj   transient
│   ├── ingest_worker:iar   transient
│   └── ingest_worker:ccp   transient
├── renderer                rest_for_one (downstream of ingest snapshot)
└── publisher (rsync+caddy) rest_for_one (downstream of renderer)
```

\* The `deploy_supervisor`'s own children (`ingest_supervisor`, `renderer`,
`publisher`) use **`rest_for_one`** so a renderer failure cascades to the
publisher; the `ingest_supervisor`'s children use **`one_for_one`** so one
worker's crash is isolated. The two strategies coexist at different tree levels,
exactly as in OTP.

**ICOS is STRUCK** from the tree (cross-tier policy). **6 workers exactly**:
`iec, iel, iah, iaj, iar, ccp`.

### Semantics (all unit-tested in `tree.supervision.test.ts`)

| Concept | Meaning | Enforced in |
|---|---|---|
| `one_for_one` | a child crash restarts ONLY that child | `strategy.ts::affectedChildIds` |
| `rest_for_one` | a child failure restarts it + every child started AFTER it (in order) | `strategy.ts::affectedChildIds` |
| `transient` | restart ONLY on abnormal exit (crash), not on normal completion | `strategy.ts::shouldRestart` |
| `permanent` | always restart | `strategy.ts::shouldRestart` |
| `max_restarts` window | exceeding the budget within the window escalates (supervisor gives up) instead of infinite-looping | `strategy.ts::budgetExceeded` |

## The 8-step per-worker contract (B1 binding)

Each `ingest_worker:<repo>` runs `runIngestWorker(repo, deps)` which executes,
**in order** — any failure crashes with a structured `IngestReason`:

1. **Fetch** `report-manifest.json` from the source repo's CI (`ManifestFetcher`).
2. **Verify OIDC** issuer + subject + `workflow_ref:` against the pinned per-repo
   allowlist `ingest/pinned-subjects.json` (`checkOidcAllowlist`, REAL claim
   comparison; wrong issuer/subject/ref → crash).
3. **Verify the Rekor inclusion proof** for each bundle row (`SigstoreVerifier`).
4. **Verify the DSSE signature** for each bundle row (`SigstoreVerifier`).
5. **Validate each bundle's schema** against `@intentsolutions/core@^0.2.0`'s Zod
   `EvidenceBundleSchema` (`validateEvidenceBundle`, REAL kernel import + parse).
6. **Content-address** each verified bundle into local object storage by sha256
   (`ContentStore`). Content-addressing is what makes a deep link **survive** a
   later source-side force-push / SHA deletion.
7. **Emit a snapshot** to the staging store + set `last_known_good_ingested_at`
   (`SnapshotStore`). Emitted **only after all rows clear** steps 3–6.
8. **On any failure**: crash with `{repo, step, reasonCode, detail, rowIndex?}`;
   the supervisor records `last_known_good_stale_since` and the renderer keeps
   the prior good snapshot.

## Production-wired vs interface-seamed

Every external dependency is behind an interface so the pipeline is
deterministically testable. Here is exactly what runs for real vs what is a seam:

| Step / node | Interface | **Production default (this repo)** | Test injection |
|---|---|---|---|
| 1 fetch manifest | `ManifestFetcher` | **wired** — `HttpManifestFetcher` (HTTPS GET + timeout) | fixture fetcher |
| 2 OIDC allowlist | `checkOidcAllowlist` (pure) | **wired** — REAL claim comparison vs `pinned-subjects.json` | inline pinned doc |
| 3 Rekor inclusion | `SigstoreVerifier` | **wired** — `SigstoreRowVerifier` (sigstore-js, `tlogThreshold ≥ 1` forces inclusion-proof verification) | `OfflineRowVerifier` (REAL Merkle proof via Node crypto) |
| 4 DSSE signature | `SigstoreVerifier` | **wired** — `SigstoreRowVerifier` (sigstore-js DSSE + Fulcio cert identity) | `OfflineRowVerifier` (REAL DSSE PAE + Ed25519/ECDSA via Node crypto) |
| 5 kernel schema | `validateEvidenceBundle` | **wired** — REAL `@intentsolutions/core` Zod `.safeParse()` | same (kernel is imported) |
| 6 content-address | `ContentStore` | **wired** — `FsContentStore` (sha256 → `/var/lib/labs-dashboard/bundles/`, mode 600) | `MemoryContentStore` (same sha256 keying) |
| 7 emit snapshot | `SnapshotStore` | **wired** — `FsSnapshotStore` | `MemorySnapshotStore` |
| renderer | `RenderSink` | node wired; **render sink injected** (HTML production lands in a later epic) | recording sink |
| publisher | `PublisherTransport` | node wired; **transport is a documented NO-OP** (`NoopPublisherTransport`) — see below | recording transport |

### Why the publisher's prod hop is a seam, not wired

The publisher's real hop is `rsync` to the Contabo VPS + `caddy reload`. That
touches **production** (24 prod containers depend on the VPS; `caddy validate`
then `systemctl reload caddy`, never restart). Per the VPS rules that is a
**human-gated ops step** performed by the GitHub Actions → Tailscale OIDC →
force-command SSH deploy workflow — **not** from this library. So this repo ships
the publisher **node + interface** plus a default transport that **no-ops with
logging** (`NoopPublisherTransport` returns `published: false` and a clear note —
it never claims to have published). Anyone wiring real deploy injects a transport
that performs the gated rsync + caddy reload.

### Why two real verifiers (sigstore + offline)

`SigstoreRowVerifier` is the production default and uses **sigstore-js** against
the live Sigstore TUF root / Fulcio / Rekor. A **unit test cannot mint a real
Fulcio cert + Rekor entry offline**, so the test suite injects
`OfflineRowVerifier` — a **second, fully real** verifier that performs genuine
cryptography with Node's `crypto`: an RFC-6962 Merkle inclusion-proof recompute
(step 3) and a DSSE PAE signature verification against a pinned key (step 4).
This makes the synthetic-attack tests genuine: a tampered payload, a tampered
audit path, or a wrong identity **really** fails the crypto and crashes the
worker. Neither verifier is a no-op. `OfflineRowVerifier` is also a legitimate
production posture for self-hosted / air-gapped pinned-key signing.

## `ingest/pinned-subjects.json`

The per-repo OIDC allowlist (issuer + subject + `workflow_ref` patterns) for the
6 repos. The GitHub OIDC issuer is `https://token.actions.githubusercontent.com`.
Entries flagged `operatorConfirmed: false` use a canonical placeholder
`workflow_ref` (`.../release.yml@refs/heads/main`-style) where the exact release
workflow ref could not be derived at authoring time — **confirm against each
repo's actual `.github/workflows/` before first production ingest**, then flip the
flag to `true`. The match semantics are exact-or-single-trailing-`*`-prefix
(no mid-string wildcards).

## Synthetic compromised-CI attack tests (mandatory)

`tests/` and `src/ingest/*.attack.test.ts` prove the fail-closed binding:

1. **Wrong `workflow_ref`** → worker crashes at step 2; the staging snapshot is
   UNCHANGED; the renderer still serves the prior snapshot.
2. **Force-pushed / deleted source SHA** → because the bundle was
   content-addressed at ingest (step 6), the stored bundle + deep link **survive**
   (retrieval by content hash works after the source SHA is gone).
3. **Network timeout on one worker** → that worker crashes + the supervisor
   retries it (transient); the other 5 workers are UNAFFECTED; the renderer uses
   the prior snapshot for the crashed repo.
