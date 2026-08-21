# J-Rig Unified Report — Tailnet Surface Specification

| | |
|---|---|
| **Doc** | 003-AT-SPEC |
| **Date** | 2026-08-01 |
| **Plan** | IEP-EVAL-EVOLUTION-001 |
| **Umbrella bead** | `bd_000-projects-htjt.5` |
| **Consumer** | `intent-eval-dashboard` |
| **Upstream contract** | `j-rig-binary-eval` PR #251, `j-rig/unified-report/v1` |

## Purpose

The dashboard consumes the J-Rig unified report as an operator-facing static
projection. The page makes the evaluation substrate legible without turning a
local report into a public attestation or a rollout decision.

This is deliberately a narrow consumer slice. J-Rig owns the versioned wire
contract and report arithmetic. The dashboard owns defensive parsing, the
tailnet-only publication boundary, and the HTML presentation.

## Input contract

The input is the JSON emitted by:

```bash
j-rig report --unified --json \
  --grader-id <id> \
  --grader-version <version> \
  --grader-snapshot-sha256 sha256:<64-hex> \
  --output unified-report.json
```

The dashboard validates `j-rig/unified-report/v1` before rendering. The
projection includes:

- the selected immutable Grader identity and snapshot digest;
- summary counts without a global pass-rate;
- explicit Task × Config × Model cell metrics, including Wilson uncertainty;
- Raw Run lineage with pending, running, completed, runner-error, and timeout
  states; and
- nullable grader verdicts so ungraded work is not silently treated as a pass.

The parser fails closed on an unknown schema version or malformed grader
snapshot digest. The dashboard does not reimplement J-Rig's database queries,
sampling planner, grader arithmetic, or report construction.

## Trust and publication boundary

This report is **not** a signed Evidence Bundle. It carries no DSSE signature,
Rekor proof, or rollout-gate decision. The generated page therefore:

- writes only below `site-internal/internal/eval-reports/j-rig/`;
- is marked `noindex, nofollow` and `iep-surface=tailnet-only`;
- labels itself as an unsigned local projection;
- refuses a destination whose basename is `site`; and
- renders no-data with the same visual weight as failure.

The existing signed Evidence Bundle ingest/results lane remains the public
publication path. A future verified publication adapter must establish its own
signature and provenance contract before any J-Rig report is allowed onto the
public origin.

## Operator command

After building the dashboard package:

```bash
pnpm run build
pnpm run generate:eval-report -- /path/to/unified-report.json site-internal
pnpm run lint:c3:internal
```

The command is intentionally not part of the no-input default generator chain:
an operator must provide a concrete report file. It never fabricates a report
when the input is absent.

## Verification

`src/eval-reports/unified-report.test.ts` covers valid parsing, fail-closed
validation, HTML escaping, no-data rendering, C3 scanning, deterministic output
path, and refusal to write to the public site root. The module reuses the
dashboard's HTML escaping and footer helpers while keeping the data-dense
layout scoped to this operator surface.

## Follow-on work

This slice does not claim live publication. The remaining evolution work is:

1. J-Rig suite/batch orchestration and real dogfood data;
2. a verified ingest adapter with an explicit provenance/signature decision;
3. static generation from an operator-controlled input path in the deployment
   environment; and
4. a human-gated tailnet Caddy route, if the operator chooses to expose it.

Those steps remain tracked in the umbrella beads; they are not implied by the
presence of this local renderer.
