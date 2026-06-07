# CRAP score

## What it is

**CRAP** (Change Risk Anti-Patterns) scores how dangerous a function is to change. It combines two signals that compound each other: cyclomatic **complexity** and test **coverage**. The formula is `CRAP = complexity² × (1 − coverage)³ + complexity`. The intuition: a complex function with no tests is a minefield; the same function fully tested is merely complex; a simple function is cheap to change either way. CRAP finds the **complex-and-untested** functions — the exact place a change is most likely to break something silently.

## How we run it

The audit-harness `crap-score` gate computes CRAP per function from the complexity metric and the coverage report, then flags any function over the threshold. The conventional healthy ceiling is **30**: under 30 is fine, over 30 means "complex enough that you must test it before you touch it." The gate emits the offending functions so they can be driven down — either by adding tests (lowers the coverage term) or by refactoring (lowers the complexity term).

## What good looks like

- **Every function under the threshold** — `good`.
- **Functions over threshold** — `fail` or `watch`. The **what to fix** list names them. For each, the cheapest win is usually **adding tests first** (coverage drops CRAP cubically), then refactoring the complexity down.
- A rising CRAP count over time is an early-warning signal of accumulating change-risk debt, even while coverage still looks fine.
