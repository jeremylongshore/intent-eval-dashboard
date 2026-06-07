# Mutation testing

## What it is

**Mutation testing** measures whether the tests actually *catch bugs*, not just whether they *run the code*. A mutation tool deliberately introduces small faults into the source — flipping a `>` to `>=`, deleting a line, swapping `&&` for `||` — and re-runs the suite. If a test fails, the mutant is **killed** (good — the tests noticed). If every test still passes, the mutant **survived** (bad — a real bug of that shape would ship undetected). Mutation testing is the honest answer to "100% coverage, but do the tests assert anything?"

## How we run it

A mutation runner (Stryker for the TypeScript repos) generates mutants across the source, runs the test suite against each, and reports the **mutation score** — the share of mutants killed. We compare it to the kill-rate floor declared in `tests/TESTING.md`. Because mutation runs are expensive, they typically run on a schedule or a dedicated CI job rather than on every push, with a baseline locked so the score cannot silently regress.

## What good looks like

- **At or above the kill-rate floor** — `good`. The tests meaningfully constrain behaviour.
- **Below the floor** — `fail`. The **what to fix** list names survived mutants; each is a missing or weak assertion. Strengthen the test until that mutant dies.
- **Surviving mutants in critical paths** matter more than the headline number — a survived mutant in a verification or money path is worth more attention than the percentage suggests.
