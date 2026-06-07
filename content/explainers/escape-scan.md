# Escape scan

## What it is

The **escape scan** is a containment check on AI-proposed changes. When code is written or edited with AI assistance, certain patterns signal that the change is trying to get around the very gates that protect the codebase — disabling a test, weakening an assertion to make it pass, editing the hash-pinned policy, or stripping a check. The escape scan classifies a staged diff against those patterns and flags `REFUSE` / `CHALLENGE` / `FLAG` signals so a human reviews before the change is trusted.

## How we run it

The audit-harness `escape-scan` gate runs over the staged diff (as a pre-commit hook and again in CI). It looks for the known escape patterns and, paired with the harness hash-pinning, refuses changes that quietly alter the testing policy without re-initialising the hash manifest. The point is not to distrust the author — it is to make any attempt to *weaken the gates* visible and deliberate rather than silent.

## What good looks like

- **No escape patterns in the diff** — `good`. The change does not try to route around the gates.
- **A flagged pattern** — `fail` or `watch` depending on class. The **what to fix** list names the pattern and where. Either the change should not weaken that gate, or the policy change is legitimate and must be made explicitly (edit the policy, re-pin the hash, document it in review).
- The escape scan is a trust amplifier: a green scan is what lets the rest of the signed evidence be taken at face value.
