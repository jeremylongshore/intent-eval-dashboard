# Verification-generation migration proposal

Status: **Locally qualified; production migration remains unactivated.**
The isolated branch combines PR111 `cdf4b4bf`, PR112 `1b1a5d7d`, and PR113
`e5da545a`; all three remain explicit unmerged dependencies. Root approved local
implementation under claimed bead `puxu.27`. No cache restore, source fetch,
dispatch, deployment, or production trust-state migration has been performed.
PR113's passing tests prove new input authentication, not historical remediation.

## Baseline before this change

The following observations refer to main `127f860c` or PR113 `e5da545a`, as
applicable, before the generation migration implementation.

- `scripts/ingest-render.ts:56,77–79` opens all three stores directly below the
  caller's root, default `.ingest-store`.
- `src/ingest/renderer.ts:71–89` reads that snapshot store after a worker fails
  and renders its previous snapshot with a stale badge. Existing metadata/body
  binding checks do not retain and cryptographically reverify the old signature.
- `.github/workflows/regenerate.yml:125–134,199–205` restores/saves the broad
  `ingest-store-` cache family. Strengthening the verifier does not change it.
- `src/results/generate.ts:145–158`,
  `src/internal-testing/generate-testing.ts:71–85`, and the analogous internal
  results writer create/overwrite emitted files but never remove omitted deep
  links. An old qualified HTML page can survive a new no-data index.
- `src/freshness/generate.ts:78–133` owns the landing-page strip between explicit
  markers and `status/index.html`, not the entire hand-maintained landing page.
- Regeneration retries a zero-fresh pass once, then skips commit/deploy. Its
  explicit deploy dispatch follows a bot commit; changing cache prefixes alone
  therefore leaves the previous published trust generation live on a blackout.

These are separate store, route and activation boundaries. Fixing only one does
not establish a safe transition.

## Small shared generation contract

Use an explicit compiled policy-generation string (`public-sigstore-auth-v1`
for the proposed public boundary), with separate public/private values, and the SHA256 of the existing canonical JSON encoding of
`{ policyGeneration, config: parsedTrustConfig }`. Public configuration is the
strictly parsed pinned-subjects configuration. Include identities, confirmation
state and other trust-affecting fields; never hash bearer-token bytes. A change
to verification semantics requires a reviewed generation bump even if the
configuration remains identical. The identifier is an isolation label, not a
signature or proof that historical data was reverified.

For public collection, open content, snapshot and gate-row stores only beneath
`<configured-root>/<public-policy-generation>/<configuration-digest>/`. Cache
keys and restore prefixes include that exact generation and digest; cache only
that selected namespace. Do not restore the broad legacy prefix, copy its rows,
follow an old active pointer or search an ancestor on a miss. Existing data stays
preserved outside the new namespace. Fresh verification is the only way to seed
it. Later failures may use last-known-good data from this same generation only.

The private design already uses `private-dsse-auth-v1` plus the same canonical
object digest. Its whole strict configuration includes credential references,
not credentials. Both configured private state and output roots append the
selector, and only that selected output namespace may be served. Reuse this
small convention without a registry, custom coordination service or mutable
cross-agent helper. Public/private namespaces are never interchangeable.

## Exact generated-route ownership

Generate into a new temporary staging tree, using only the selected store.
Prepare a reviewed ownership manifest before replacing any existing files:

- Public generated results index, known-repo indexes and bundle deep-link
  `index.html` routes under `results/`; `evals/index.html`; `status/index.html`.
- Only the documented freshness region of public `index.html`.
- Operator-only generated routes under `internal/testing/` and
  `internal/results/`, including old deep links. The latter writer is not called
  by today's live collector, so the transition must explicitly regenerate that
  owned surface from the new generation or replace it with honest no-data.

Bootstrap the prior route set from tracked known generator shapes and the fixed
repo inventory, then record the emitted set for subsequent runs. Reject unknown
files, path traversal, symlinks or overlapping ownership instead of recursively
wiping arbitrary directories. Preserve methodology, eval sets, skills, assets,
health checks and other unrelated authored pages. Reapply existing retraction
policy/tombstones; a removed historical result must not resurrect retracted data.

For every previously owned result route omitted by the new generated set,
prepare removal or an explicit unverified-history tombstone. No route may keep
an old qualified result merely because it is absent from the new index. Keep
original bytes in Git history and a digest-addressed operator backup outside
both published roots and outside `git add -A`'s scope. Do not put quarantined
HTML under a publicly reachable backup directory. Store contents are not deleted.

Validate the complete staged route set, generation receipt, C3 controls,
retractions and internal/public separation before applying it to the checkout.
Publish only after the whole candidate succeeds. This is staged Git-artifact
replacement, not a claim of an atomic transaction across independent production
roots or snapshot stores.

## Explicit first activation and the blackout rule

Ordinary scheduled operation must not silently interpret legacy output as
current-generation verified output. A missing/mismatched active-generation
receipt is **migration required**, not successful refresh or routine transient
blackout. Produce a loud structured refusal and a reviewable candidate/route
inventory; do not automatically commit or dispatch deployment. While held, the
old deployment remains a known historical-trust limitation, not remediation.

The proposed first activation is an explicitly reviewed, main-only manual
migration operation bound to the source commit, generation and config digest.
It is distinct from the existing `force_commit` debug input. It starts with an
empty new namespace and no legacy restore, prepares the exact owned-route
replacement, and records fresh/failed repo outcomes without public secrets.

If at least one fresh repo supplies an actually verified nonempty row set, the proposed activation still replaces every
omitted old qualified route and marks unverified repos no-data. If zero verify,
normal blackout behavior remains unchanged: **no automatic publish**. The
operator must separately approve publishing the staged quarantine/no-data
surface (or a reviewed maintenance surface) as the first-generation transition.
That approval is an explicit exception to preserving the previous site on zero
fresh results; neither code merge, this document nor `force_commit` grants it.
No-data publication must identify why evidence is unavailable and must not
claim a passed rollout or successful live re-verification.

Record activation only after the exact generation artifact is deployed and
representative removed/deep-link/status routes are checked. Subsequent ordinary
zero-fresh outages may preserve the already activated current-generation site;
partial failures may retain only current-generation verified snapshots. Failure
to write, validate, publish or confirm the generation never promotes old state.

## Implementation boundary and verification plan

After design approval, implement the namespace/config-digest resolver, exact
cache routing, owned-route staging/reconciliation and explicit migration state
machine as a bounded change. Keep PR113 authentication, PR112 repo provenance
and PR111 supervision dependencies explicit. Do not change public/private trust
identities, enroll keys, fetch paid providers or dispatch production workflows
as part of local qualification.

Local fixtures must prove: legacy cache cannot be selected; changing policy or
config changes the namespace; same-generation LKG survives ordinary failures;
old deep links disappear or become unverified tombstones; unrelated/retracted
routes survive; invalid paths/symlinks fail closed; a zero-fresh first migration
cannot silently publish or masquerade as a current generation; later blackout
behavior is retained. Test representative default CLI/workflow paths, not just
helpers. Archive candidate file lists/digests and failure receipts. Real source
compatibility and production activation are separate qualifications.

## Rollback and held decisions

A rollback must retain the new trust namespace and strengthened authentication.
Disable supervision or pause collection independently if needed. Serve the last
verified current-generation artifact; if none exists, use the explicitly
approved quarantine/maintenance artifact. Never fall back to the old cache,
flatten repo-scoped sidecars, restore old qualified routes or reactivate a
legacy-generation deployment as an availability shortcut. Preserve historical
bytes for investigation, outside published output.

The concrete owner-held decision is the first production migration, especially
whether an all-no-data/quarantine result may replace the existing site if live
sources do not verify. The design and local implementation can proceed without
that activation decision. Host read-only source-compatibility findings will
inform the reviewable activation candidate; they are not approval to publish it.

## Prepared local interface (not yet validated)

`--print-generation` resolves the compiled policy and parsed-config digest without
network access. Default collection opens only that namespace and refuses missing
or mismatched generation markers before fetching. `--prepare-trust-migration DIR`
creates a new isolated candidate and receipt without changing served roots.
`--apply-prepared-generation DIR` verifies committed source/configuration, route
inventory and file hashes, backs up exact owned files under Git metadata, then
applies the candidate to the checkout. Zero verified evidence additionally requires
`--allow-empty-trust-migration`; that flag authorizes only local artifact preparation,
never publication. An empty manifest's fresh worker status cannot qualify activation.

Both prior generation markers are invalidated before route writes. Final markers
are written only after all replacements and obsolete owned-route removals succeed.
A partial failure leaves a checkout that must not be published; the operation does
not automatically restore old trust from backups. No multi-root atomic filesystem
transaction or protection against a hostile concurrent process is claimed.

The workflow preparation input defaults false and excludes commit/deploy steps.
Candidate internal HTML remains runner-local, never uploaded as a public artifact.
Operators must retain a reviewed local candidate for eventual approved publication;
runner-local preparation alone is not a durable transport or activation receipt.

### Local review and source provenance

Use a dedicated clean checkout of the reviewed source and a normal locked install,
then `pnpm build`. The build wrapper runs the existing single TypeScript compilation,
records relevant tracked-input and compiled-byte digests, and refuses concurrent
input changes. Generation checks those digests and requires committed inputs.
Inputs include config, executable source, data, explainers, workflow definitions and
retraction policy. Explicit exclusions are generated site roots, the generated retraction snippet, project record/docs
directories, root README/CHANGELOG/agent instructions, and the harness hash file.
No ignored credential files are inventoried. Documentation-only HEAD advancement
can leave the compiled-byte/input relationship unchanged; the compilation revision
and candidate preparation revision are distinct records, not a claimed identical SHA.

Run `node --experimental-strip-types scripts/ingest-render.ts
--prepare-trust-migration /private/operator-review/candidate` (on one shell line)
with an existing private parent directory. Retain that complete candidate locally,
review its route inventory, generated public/internal surfaces and source/config
binding, then use the explicit apply command in the same clean checkout. Backups
remain under Git metadata and are never a source for automatic rollback or serving.
Review the resulting Git diff before any separately authorized publication.

The manual workflow also runs its existing eval-set Python regeneration, which may
change checkout output before migration staging. Thus the workflow promises **no
commit, deployment or activation**, not an untouched checkout. The migration CLI's
preparation mode itself leaves served roots unchanged. The ephemeral runner candidate
is a diagnostic preparation only; the durable operational review path is the local
private candidate above. No public artifact transports internal HTML.

### Qualification boundary

The initial integrated focused chain passed 19 tests across four files, types,
fresh build and lint in 91.21 seconds. That receipt predates the explicit candidate
input/compiled digest fields and is retained as historical evidence. The final combined qualification then passed 20 targeted tests and the complete
612-test, 57-file suite in both check and native coverage. Coverage was 99.03%
statements/lines, 92.87% branches, and 99.69% functions, above unchanged floors.
The full chain took 342.51 seconds, including 246.41 seconds for the final full
stage. Source hashes were unchanged across qualification; 34 generated fixture
outputs were archived privately and restored. The qualified staged tree was
`4ef10d0cf6103460a5cb976f20ed28b8946192f7`; this results-only document update
follows that tree and does not change executable bytes. Tests separately distinguish an existing seeded
current-generation snapshot from the nonempty signed-fixture worker/live-pass
retention proof; an empty synthetic seed is not claimed to be cryptographically
verified evidence. Public empty-manifest admission refusal from `puxu.28` is included
in this candidate, so normal freshness signals cannot promote an empty claim.
