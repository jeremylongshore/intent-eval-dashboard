# Harness hash

## What it is

The **harness hash** is the integrity check on the testing policy itself. The audit-harness records a SHA-256 of every policy-bearing script and the policy manifest into a pinned file (`.harness-hash`). `harness-hash --verify` recomputes those digests and confirms they still match the pin. In plain terms: *has anyone changed the gates — the coverage floor, the escape-scan rules, the architecture checker — without doing it openly?* A passing harness hash means the gates that produced all the other evidence are themselves the ones that were reviewed and pinned.

## How we run it

`harness-hash --verify` runs in CI on every change and again at release time. It is the foundation the rest of the evidence stands on: a coverage number or an escape-scan result only means something if the script that produced it hasn't been quietly edited. If a policy script changes legitimately, the author re-pins the manifest (`audit-harness init`) and commits the new `.harness-hash` alongside the change — so the edit is explicit and reviewable, never silent.

## What good looks like

- **All digests match the pin** — `pass`. The testing policy is intact; no gate was altered out-of-band.
- **A digest drift** — `fail`. The **what to fix** list names which script drifted. Either the change should not have touched a pinned policy file, or the policy change is legitimate and must be re-pinned + reviewed explicitly.
- This gate is a trust amplifier: a green harness hash is what lets every other signed gate-result on this page be taken at face value — it proves the gates weren't moved.
