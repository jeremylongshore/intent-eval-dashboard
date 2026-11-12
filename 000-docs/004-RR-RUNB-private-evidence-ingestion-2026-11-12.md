# Private evidence collection

Status: locally qualified implementation; no private source enrolled and no
production collection or authenticated serving activated. Refs bead
`bd_000-projects-dn6j.9`. This work is stacked on the repository-scoped sidecar
change in PR112 at `1b1a5d7d33740f8c668178e9344ac861924d1fc9` and incorporates
the shared verifier hardening from PR113 at
`e5da545a4fd0c7636775ede12e94add787a25749`. Neither dependency is assumed merged;
the private wrapper adds DSSE admission and redaction around that shared verifier.

## Boundary

The private command fetches signed release manifests using explicit operator
configuration and repository-bound credential references. It uses the existing
verify-before-persistence worker, namespaced stores and internal testing renderer.
It never runs public results, public freshness/status, Git staging, deployment,
or Actions cache/artifact operations. Private source labels, failures and timestamps
must not enter the public regeneration command, including its freshness input.
The existing public pins and eight-source list remain unchanged.

Private transport does not make a public transparency log private. Before actual
enrollment, review what the producer signs and submits to Fulcio/Rekor. This change
creates no signatures or public log submissions. The private verifier requires
inclusion proofs with checkpoints, then delegates cryptographic verification to
Sigstore; a signed inclusion promise alone is insufficient. Certificate identity
matching is escaped and anchored to the entire expected workflow URL.

## Configuration and credentials

This implementation requires Linux/POSIX ownership and permission semantics;
platforms without a current UID fail closed. Create a dedicated operator-owned
private root outside every Git worktree and public output/cache root. All directories must be 0700 and files 0600; the command
rejects symlinks, hard-linked files, permissive existing descendants and unsafe
ancestors. A normal root-owned sticky `/tmp` parent is allowed for fixtures; do not
use temporary fixture roots as a production retention policy. Same-UID hostile
processes and root remain trusted; these checks are not a sandbox against them.

The root contains separate enrollment file, credential directory, state directory
and output directory. They must not overlap. Credentials are separately provisioned
files, named by the explicit reference; no ambient GITHUB_TOKEN discovery occurs.
The token itself must never appear in JSON, a URL, source control or logs. Prefer a
GitHub App installation token restricted to the enrolled repositories, with
Contents:read; fine-grained repository-scoped Contents:read tokens use the same
adapter. Provisioning, renewal and actual server-side permission verification are
operator responsibilities, not performed by this command.

Example with synthetic identifiers only:

```json
{
  "version": 1,
  "issuer": "https://token.actions.githubusercontent.com",
  "sources": [{
    "key": "private-example",
    "githubRepo": "example/private-repo",
    "release": { "kind": "tag", "tag": "evidence-latest" },
    "asset": "report-manifest.json",
    "credentialRef": "example-reader",
    "operatorConfirmed": true,
    "subjects": ["repo:example/private-repo:ref:refs/tags/*"],
    "workflowRefs": ["example/private-repo/.github/workflows/release.yml@refs/tags/*"]
  }],
  "credentials": [{
    "ref": "example-reader",
    "repositories": ["example/private-repo"]
  }],
  "downloadHosts": ["release-assets.githubusercontent.com"]
}
```

Confirm the actual subject/workflow identity before setting operatorConfirmed.
Configuration and credential binding are protected authority, never data from the
manifest or release. A source is always internal in this lane, even if its key
matches a public Tier1 alias. Adding another approved private source requires
configuration and credentials, not application source changes. A tag or latest
selector is not an immutable-content guarantee; downloaded signatures and payload
bindings still determine admissibility.

The exact download hostname above is a proposed operator allowlist, not a promise
that GitHub will never change its CDN. Confirm it during approved live qualification.
An unexpected host fails closed. The fixed api.github.com adapter requests
API version 2026-03-10 and handles binary 200 or one 302 handoff, with no Authorization
or cookies forwarded to download. It never follows metadata redirects, arbitrary
upstream API URLs, or another download redirect. GitHub documents
[release lookup permissions](https://docs.github.com/en/rest/releases/releases#get-a-release-by-tag-name)
and [asset permissions and 200/302 responses](https://docs.github.com/en/rest/releases/assets#get-a-release-asset).

Enrollment files are bounded to 128 KiB and credential files to 8 KiB; the
configuration admits at most 100 sources. Limits are local transport admission
policy: metadata 1 MiB per response, manifest
16 MiB, ten pages of 100 assets, one 30-second deadline across the entire acquisition.
Actual streamed bytes and strict UTF8 are checked, not just Content-Length.
Incomplete listing, ambiguous filename, zero-row manifests or limit exhaustion
fails closed; a source with no signed rows cannot replace prior verified state. Failure
messages use finite codes; no raw response bodies, URLs or secrets are printed.

## Invocation and serving

The normal `pnpm run check` builds once before tests so its actual CLI regression
works from a clean checkout. Standalone `pnpm test` or `pnpm run test:coverage`
must be preceded by `pnpm run build` after source changes; a warm `dist` alone
is not fresh-source qualification.

After the normal build, an authorized operator may invoke:

```bash
node --experimental-strip-types scripts/ingest-private.ts \
  --private-root /operator-owned/private-evidence \
  --config /operator-owned/private-evidence/enrollment.json \
  --credentials /operator-owned/private-evidence/credentials \
  --state /operator-owned/private-evidence/state \
  --output /operator-owned/private-evidence/output
```

The CLI reports aggregate source/verified/failed counts plus an opaque `generation`
selector, and returns nonzero for failed collection. It preserves last verified snapshots and renders stale/no-data
states. Existing seven-day paging and public supervisor policy are unchanged.
The reusable orchestrator temporarily uses umask 077 and restores it; run this
command as a dedicated process, not concurrently with unrelated filesystem work
inside the same Node process.

The selected output namespace includes the existing shared stylesheet copied
from the tracked public asset without changing that public file.

Output directories are not authentication. DR-035 keeps the full operator-results
view tailnet-only. DR-040 separately permits the named internal testing surface on
`internal.intentsolutions.io` behind basic auth, subject to all five controls:
TLS/CAA, credential rotation, weekly leakage detection, brute-force throttling and
audit logging. It does not authorize a locked route on public labs or unrestricted
exposure of private partner data. This command publishes neither surface. The
owner must approve the actual reader identity, source enrollment and serving
boundary, then verify anonymous/unauthorized access is denied before activation.

Never invoke this command from the existing public regeneration workflow, whose
broad Git staging and whole-store cache are unsuitable for private evidence. Do
not add private pins to the public list. Discovery of previously exposed private
material is a separate incident; this change does not purge caches or history.

## State and output generations

The configured state/output directories are containers, not active store/site
roots. Both append `<policy-generation>/<configuration-sha256>/`; the CLI returns
that relative selector as `generation`. Publish only the corresponding output
subdirectory after checking its current authentication/enrollment boundary. Never
serve the entire output container or silently reuse a prior selector.

The compiled `private-dsse-auth-v1` generation names the current literal identity,
consumed payload, actual inclusion-proof/checkpoint and private DSSE admission
policy. Advance it when verification policy changes. It is not configurable by
manifest or operator JSON, and does not magically detect arbitrary future edits.
The fingerprint covers canonical JSON of that generation and the complete strict
parsed enrollment configuration, including identity pins, aliases, selectors and
credential references/bindings. Token file contents are never included; rotating
credential bytes under an unchanged binding retains the namespace. Configuration
array reordering may conservatively start a new namespace.

There is no unversioned or other-generation fallback. Copied public caches and
previously unversioned private stores are never consulted. With no newly verified
snapshot, a current failure renders no-data even when old containers contain rows.
Unchanged enrollment/policy retains its own legitimately verified prior snapshot;
changed pins, repository identity or alias start empty state and output until
fresh verification succeeds. Old directories remain untouched for investigation;
no active pointer or deletion automatically promotes/destroys prior artifacts.
This prevents accidental legacy reuse, not deliberate same-UID forgery of a new
namespace or retrospective exposure of already published output.

## Qualification and rollback

Local tests use synthetic credentials, mocked HTTP/TUF acquisition and real
Sigstore fixture certificates, signatures and checkpoints. They do not prove real
GitHub token scope, CDN availability, private enrollment or deployed authentication.
The final live acceptance still requires an authorized private producer→fetch→
verify→authenticated internal view demonstration with public outputs unchanged.
Record local and operational evidence separately; do not close the original
private/estate publishing task on fixture success alone.

Rollback stops the private invocation/publisher and serves only an approved prior
verified private snapshot, or denies service. Preserve private state for diagnosis;
do not flatten repository namespaces, downgrade to a legacy reader, export private
files into public storage, or fall back to anonymous/unsigned ingestion. Existing
public collection remains operational.

## Dependency qualification scope

Synthetic certificate fixtures use pinned upstream Sigstore development helpers.
Normal pnpm resolution also deduplicates the production transitive Sigstore graph
from core 4.0.0 to 4.0.1 and protobuf-specs 0.5.1 to 0.5.2 within existing compatible
ranges. No new direct production dependency is introduced, but the resolved
production graph is changed and requires the full candidate checks. An old-source
comparison on this candidate graph isolates source behavior; it is not an exact
reproduction of a previously deployed environment.

## Producer format compatibility remains explicit

DR-035 B1 names row-by-row DSSE signature verification and Rekor inclusion proof.
The private lane therefore requires a DSSE envelope, checks its decoded payload
bytes exactly against the bundle the worker will persist, and verifies the actual
signature/proof with Sigstore. Sigstore's DSSE verifier does not itself compare an
external payload argument; the explicit equality check supplies that binding.

Existing core and J-Rig release/nightly workflows also contain `cosign sign-blob`
producers, which emit the different messageSignature format. This change does not
silently declare that format equivalent to the ratified DSSE requirement or modify
those producers. Config-only onboarding applies to sources already emitting the
approved manifest/DSSE contract. Blob-only sources need a producer migration or a
documented format-equivalence decision before private enrollment; this remains
part of the original end-to-end acceptance, not a completed estate-wide claim.

## Local qualification receipt

The uncommitted integration candidate at staged tree
`a01ae723ee7f840a3f1d77ace2ff5170fe8713cc` passed the exact reordered `pnpm run check`
from an absent `dist` directory: 677 tests across 60 files, 83.165 seconds for the
complete check chain. The following full native coverage run passed the same
677 tests in 46.596 seconds, with 99.06% statements/lines, 92.86% branches and
99.41% functions; existing floors remain 95/95/90/95. Harness verification passed,
and the source hash receipt confirmed no changes during the run.

These are author-local observations on Node 22.23.1/pnpm 9.15.0, under a transient
4 CPU/4 GiB limit with one Vitest worker. They are not hosted CI, deployed privacy
proof, billing measurements or causal speed savings. Earlier fixture/type/lint
failures were retained. Only documentation attribution/receipt text changed after
this frozen qualification; documentation checks cover that subsequent delta.
