# Coverage

## What it is

Test **coverage** measures how much of the code is actually exercised by the test suite — the lines, branches, and functions a test run touches at least once. It is a floor, not a ceiling: high coverage does not prove the tests are good, but **low coverage proves there is code no test has ever run.** Untested code is where regressions hide.

## How we run it

Coverage is produced by the test runner during the normal test pass (for the TypeScript repos, `vitest run --coverage` via the V8 provider). The result is compared against the repo's declared floor in `tests/TESTING.md` — for the dashboard repo that floor is **95% lines / 95% functions / 90% branches / 95% statements**. The gate is a required CI check: a pull request that drops coverage below the floor fails, and the fix is to add tests, never to lower the floor.

## What good looks like

- **At or above the declared floor** on every dimension — `good`.
- **Below the floor** — `fail`. The fix is the list of files or symbols dragging it down; add tests for them.
- A high number with whole **dimensions skipped** is not a clean pass — check the "what we measured" block. A dimension we did not measure is not one we passed.
