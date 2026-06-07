# Architecture rules

## What it is

The **architecture** gate enforces the dependency rules that keep a codebase from rotting into a ball of mud. It encodes "what is allowed to import what" as machine-checkable rules — for example, the contracts kernel must not import a runtime, a pure module must not reach into I/O, a public surface must not depend on a test fixture. These rules are the structural boundaries the design depends on; once a forbidden edge sneaks in, the boundary is gone and every future change erodes it further.

## How we run it

The audit-harness `arch-check` gate walks the import graph and checks it against the repo's declared forbidden-dependency rules (the dashboard's kernel-consumer rule set, for instance, forbids vendoring kernel types instead of importing `@intentsolutions/core`). Any import that matches a forbidden rule is a violation. It runs as a required CI check, so a boundary-breaking import is caught in the pull request that introduces it rather than discovered months later.

## What good looks like

- **No forbidden edges** — `good`. The declared boundaries hold.
- **One or more violations** — `fail`. The **what to fix** list names the exact forbidden import (from → to) and the rule it breaks. Remove the dependency or, if the rule is genuinely wrong, change the rule deliberately in review — never silence the check.
- Architecture rules are most valuable when they **fail loudly and early**; a green arch gate is a precondition for trusting the rest of the design.
