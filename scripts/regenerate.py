#!/usr/bin/env python3
"""
regenerate.py — daily-cron refresher for labs.intentsolutions.io eval-set pages.

Reads data/eval-sets.json. For each active eval-set, queries the upstream
GitHub repo via `gh api` for:
  - latest release tag (or fallback to last main commit SHA)
  - last-changed date

Then:
  1. Updates the meta-block `<dd data-auto="true">…</dd>` cells in each
     per-eval-set HTML page (in-place edit; idempotent).
  2. Regenerates the eval-sets/index.html listing from manifest + live data.

Exits 0 if nothing changed. Exits with non-zero only on errors —
the GitHub Actions workflow checks `git diff --quiet` to decide whether
to commit + push, not this script's exit code.

Hard refusals enforced inline (matches deploy.yml CI gates):
  - No predicate URI declarations under labs.* (CISO binding)
  - No aggregate <X>/<N> pass or <X>% pass output (C3 binding)
  - No partner-name hits (DR-004 backstop)
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = REPO_ROOT / "data" / "eval-sets.json"
SITE_ROOT = REPO_ROOT / "site"
INDEX_PATH = SITE_ROOT / "eval-sets" / "index.html"

# Regex patterns enforced by deploy.yml CI gates — re-checked here so
# the cron never commits content that would fail the deploy.
PARTNER_NAME_PATTERN = re.compile(
    r"Kobiton|Polygon|Nixtla|Lit Protocol|Mudit Gupta|Mudit", re.IGNORECASE
)
PREDICATE_URI_AT_LABS_PATTERN = re.compile(
    r"labs\.intentsolutions\.io/[a-z-]+/v[0-9]+"
)
AGGREGATE_PASS_PATTERN = re.compile(r"[0-9]+/[0-9]+ pass|[0-9]+% pass")


def gh_api(path: str) -> dict | list:
    """Call `gh api <path>` and return parsed JSON. Raises on non-zero exit."""
    result = subprocess.run(
        ["gh", "api", path],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"gh api {path} failed: {result.stderr.strip()}")
    return json.loads(result.stdout)


def fetch_upstream_state(upstream: dict) -> dict:
    """Query latest version + last-changed for an upstream source."""
    owner = upstream["owner"]
    repo = upstream["repo"]
    branch = upstream.get("branch", "main")

    # Try latest release first; fall back to branch HEAD if no releases yet.
    try:
        release = gh_api(f"repos/{owner}/{repo}/releases/latest")
        version = release.get("tag_name", "").lstrip("v") or "unreleased"
        last_changed_at = release.get("published_at", "")
    except RuntimeError:
        version = "unreleased"
        last_changed_at = ""

    # Branch HEAD info for last-changed (more accurate than release date).
    try:
        commit = gh_api(f"repos/{owner}/{repo}/commits/{branch}")
        commit_date = commit["commit"]["committer"]["date"]
        # Prefer branch HEAD date if newer (covers post-release commits).
        if not last_changed_at or commit_date > last_changed_at:
            last_changed_at = commit_date
    except (RuntimeError, KeyError):
        pass

    return {
        "version": version,
        "last_changed_at": last_changed_at[:10] if last_changed_at else "unknown",
        "upstream_url": f"https://github.com/{owner}/{repo}",
    }


def update_eval_set_page(
    eval_set: dict, upstream_state: dict
) -> tuple[bool, str | None]:
    """Update in-place the data-auto cells in a per-eval-set HTML page.

    Returns (changed, error_msg_or_None).
    """
    page_path = SITE_ROOT / eval_set["page_path"].lstrip("/") / "index.html"
    if not page_path.exists():
        return False, f"page not found: {page_path}"

    content = page_path.read_text()
    original = content

    # Update <dd data-auto="version"><code>X.Y.Z</code></dd>
    version_marker = re.compile(
        r'(<dd data-auto="version"><code>)[^<]+(</code></dd>)'
    )
    if version_marker.search(content):
        content = version_marker.sub(
            rf'\g<1>{upstream_state["version"]}\g<2>', content
        )

    # Update <dd data-auto="last_changed_at">YYYY-MM-DD</dd>
    lcd_marker = re.compile(
        r'(<dd data-auto="last_changed_at">)[^<]+(</dd>)'
    )
    if lcd_marker.search(content):
        content = lcd_marker.sub(
            rf'\g<1>{upstream_state["last_changed_at"]}\g<2>', content
        )

    # Hard-refusal scans before write — refuse to commit violating content.
    refusal = check_refusals(content, str(page_path))
    if refusal:
        return False, refusal

    if content != original:
        page_path.write_text(content)
        return True, None
    return False, None


def render_listing(manifest: dict, live_state: dict[str, dict]) -> str:
    """Render eval-sets/index.html from manifest + live state."""
    rows = []
    for eval_set in manifest["eval_sets"]:
        es_id = eval_set["id"]
        state = live_state.get(es_id, {})
        version = state.get("version", "unknown")
        last_changed = state.get("last_changed_at", "unknown")
        upstream = eval_set["upstream"]
        upstream_url = f'https://github.com/{upstream["owner"]}/{upstream["repo"]}/tree/{upstream.get("branch", "main")}'
        page_url = eval_set["page_path"]
        rows.append(
            f"""            <li class="eval-list__item">
                <h3 class="eval-list__title">
                    <a href="{page_url}">
                        {eval_set["title"]}
                    </a>
                    <span class="badge badge--{eval_set["status"]}" style="margin-left: 0.5rem;">{eval_set["status"]}</span>
                </h3>
                <p class="eval-list__meta">
                    Updated <code data-auto="last_changed_at">{last_changed}</code> · test version <code data-auto="version">{version}</code> · <a href="{upstream_url}">source on GitHub</a>
                </p>
                <p class="eval-list__desc">
                    {eval_set["short_description"]}
                </p>
            </li>"""
        )
    eval_list_block = "\n".join(rows)

    # Scorecards — signed RESULTS, distinct from eval-sets (which are SPECS).
    # The eval-set is the spec; a scorecard is a derivative rendering of runs
    # against it. We keep the two visually + structurally separate so a reader
    # never mistakes a result for the specification (Karpathy/Software-2.0
    # "the eval set is the spec" — results are downstream of it).
    scorecard_rows = []
    for sc in manifest.get("scorecards", []):
        state = live_state.get(sc["id"], {})
        version = state.get("version", "")
        last_changed = state.get("last_changed_at", "")
        meta_bits = []
        if version:
            meta_bits.append(f'test version <code data-auto="version">{version}</code>')
        if last_changed:
            meta_bits.append(
                f'updated <code data-auto="last_changed_at">{last_changed}</code>'
            )
        attestation = sc.get("attestation_status", "")
        if attestation:
            meta_bits.append(f"evidence <code>{attestation}</code>")
        meta_line = " · ".join(meta_bits)
        scorecard_rows.append(
            f"""            <li class="eval-list__item">
                <h3 class="eval-list__title">
                    <a href="{sc["page_path"]}">
                        {sc["title"]}
                    </a>
                    <span class="badge badge--{sc["status"]}" style="margin-left: 0.5rem;">{sc["status"]}</span>
                </h3>
                <p class="eval-list__meta">
                    {meta_line}
                </p>
                <p class="eval-list__desc">
                    {sc["short_description"]}
                </p>
            </li>"""
        )
    scorecards_block = "\n".join(scorecard_rows)

    return LISTING_TEMPLATE.format(
        eval_list=eval_list_block,
        scorecards_list=scorecards_block,
        cron_last_run_utc=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        estate_bar=estate_bar(),
    )


def estate_bar() -> str:
    """The canonical network strip, indented exactly as SITE_HEADER emits it.

    Vendored from intent-solutions-landing/estate-bar by scripts/sync-estate-bar.sh.
    The header test compares every page's header with the TypeScript SITE_HEADER
    byte for byte, so this must indent the fragment the same way (4 spaces).
    """
    fragment = Path(__file__).resolve().parent.parent / "vendor/estate-bar/fragments/estate-bar.labs.html"
    return "\n".join("    " + line for line in fragment.read_text(encoding="utf-8").strip().splitlines())


LISTING_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>What we test | Intent Labs</title>
    <meta name="description" content="Test AI skills, agent loops, workflows and the systems around them. Understand the job, the limits and the evidence before expanding use.">
    <link rel="canonical" href="https://labs.intentsolutions.io/eval-sets/">
    <link rel="stylesheet" href="/style.css">
    <meta name="iep-source-repo" content="github.com/jeremylongshore/intent-eval-dashboard">
    <meta name="iep-dashboard-version" content="0.1.0">
    <meta name="iep-cron-last-run" content="{cron_last_run_utc}">
</head>
<body>
<header class="site-header">
{estate_bar}
    <div class="site-header__inner">
      <a href="/" class="site-header__wordmark">Intent&nbsp;Labs</a>
      <nav class="site-nav" aria-label="Primary">
        <a href="/eval-sets/">What we test</a>
        <a href="/how-it-works/">How it works</a>
        <a href="/examples/">Examples</a>
        <a href="/start/">Start here</a>
      </nav>
    </div>
  </header>
    <main>
        <h1>From one skill to the whole workflow.</h1>
        <p class="lead">Test whether AI gets the job done, stays within its limits and knows when to stop.
            The task sets the rules, not the model brand.</p>
        <dl class="scope-list">
            <div><dt>Skills and instructions</dt><dd>Does the agent follow the instructions, produce the required work and handle unusual requests?</dd></div>
            <div><dt>Agent loops</dt><dd>Does it make progress, recover from errors and stop instead of repeating or spending without a limit?</dd></div>
            <div><dt>Workflows and teams of agents</dt><dd>Do tool calls and handoffs produce the right result while respecting permissions and human review?</dd></div>
            <div><dt>The system around the agent</dt><dd>Do required checks run, records stay intact and release rules stop work that is not ready?</dd></div>
        </dl>
        <p>Published examples currently focus on skills and the platform's own checks.
            Testing your workflow means connecting its runner and recording the steps you want checked.
            <a href="/methodology/#tooling">See current tooling and integration limits</a>.</p>
        <div class="hero-actions"><a class="button button--primary" href="/start/">Plan an evaluation</a>
            <a class="button" href="/how-it-works/">How testing works</a></div>
        <h2>Real results, explained</h2>
        <p>Read <a href="/examples/">the short version</a>, or inspect these published studies.
            A result applies to the setup and checks described, not every possible use of the system.</p>
        <ul class="eval-list">
{scorecards_list}
        </ul>
        <h2>Detailed test definitions</h2>
        <p>These pages describe the checks behind the studies. Active means the test is in use;
            draft means it is under review. A definition's status is not a test outcome.</p>
        <ul class="eval-list">
{eval_list}
        </ul>
        <p>Found an unclear rule? Each definition links to its source on GitHub so you can raise an issue.</p>
    </main>
<footer class="site-footer"><div class="site-footer__inner">
    <div><strong>Intent Labs</strong><br>Part of <a href="https://intentsolutions.io/">Intent Solutions</a></div>
    <div><a href="/results/">All results</a> · <a href="/methodology/">Technical guide</a> ·
      <a href="https://evals.intentsolutions.io/">Result definitions</a> · <a href="/skills/">Skill signals</a> ·
      <a href="/status/">Lab status</a><br>
      <a href="/status/" class="footer__commitment">best-effort, single-operator, see /status for liveness</a>
    </div>
  </div></footer>
</body>
</html>
"""


def check_refusals(content: str, path: str) -> str | None:
    """Return error message if content violates any hard-refusal rule."""
    if PARTNER_NAME_PATTERN.search(content):
        return f"REFUSAL: {path} contains partner-name pattern (DR-004 S1Q2 binding)"
    if PREDICATE_URI_AT_LABS_PATTERN.search(content):
        return f"REFUSAL: {path} declares predicate URI under labs.* (CISO binding)"
    if AGGREGATE_PASS_PATTERN.search(content):
        return f"REFUSAL: {path} contains aggregate PASS% (C3 binding)"
    return None


def main() -> int:
    if not MANIFEST_PATH.exists():
        print(f"FAIL: manifest not found at {MANIFEST_PATH}", file=sys.stderr)
        return 2

    manifest = json.loads(MANIFEST_PATH.read_text())

    live_state: dict[str, dict] = {}
    errors: list[str] = []

    print("regenerate.py — refreshing eval-set pages from upstream metadata")
    print(f"  manifest: {MANIFEST_PATH.relative_to(REPO_ROOT)}")
    print(f"  active eval-sets: {len(manifest['eval_sets'])}")
    print()

    for eval_set in manifest["eval_sets"]:
        es_id = eval_set["id"]
        upstream = eval_set["upstream"]
        print(f"  [{es_id}]")
        try:
            state = fetch_upstream_state(upstream)
            live_state[es_id] = state
            print(f"    upstream: {upstream['owner']}/{upstream['repo']}@{upstream.get('branch', 'main')}")
            print(f"    version:  {state['version']}")
            print(f"    changed:  {state['last_changed_at']}")
        except Exception as exc:
            errors.append(f"{es_id}: upstream fetch failed: {exc}")
            print(f"    ERROR: {exc}", file=sys.stderr)
            continue

        changed, err = update_eval_set_page(eval_set, state)
        if err:
            errors.append(f"{es_id}: page update failed: {err}")
            print(f"    ERROR: {err}", file=sys.stderr)
        elif changed:
            print(f"    page:     UPDATED")
        else:
            print(f"    page:     unchanged")

    # Scorecards: fetch upstream state so version/last-changed cells populate,
    # and refresh the per-scorecard page's data-auto cells in place. Scorecards
    # are results (signed runs), distinct from eval-sets (specs).
    for scorecard in manifest.get("scorecards", []):
        sc_id = scorecard["id"]
        upstream = scorecard.get("upstream")
        print(f"  [scorecard:{sc_id}]")
        if not upstream:
            continue
        try:
            state = fetch_upstream_state(upstream)
            live_state[sc_id] = state
            print(f"    upstream: {upstream['owner']}/{upstream['repo']}@{upstream.get('branch', 'main')}")
            print(f"    version:  {state['version']}")
        except Exception as exc:
            errors.append(f"{sc_id}: upstream fetch failed: {exc}")
            print(f"    ERROR: {exc}", file=sys.stderr)
            continue
        if "page_path" in scorecard:
            changed, err = update_eval_set_page(scorecard, state)
            if err:
                errors.append(f"{sc_id}: page update failed: {err}")
                print(f"    ERROR: {err}", file=sys.stderr)
            elif changed:
                print(f"    page:     UPDATED")
            else:
                print(f"    page:     unchanged")

    # Regenerate the listing index.
    listing_html = render_listing(manifest, live_state)
    refusal = check_refusals(listing_html, str(INDEX_PATH))
    if refusal:
        errors.append(refusal)
        print(f"ERROR: {refusal}", file=sys.stderr)
    else:
        original = INDEX_PATH.read_text() if INDEX_PATH.exists() else ""
        if listing_html != original:
            INDEX_PATH.write_text(listing_html)
            print(f"  listing:    {INDEX_PATH.relative_to(REPO_ROOT)} UPDATED")
        else:
            print(f"  listing:    {INDEX_PATH.relative_to(REPO_ROOT)} unchanged")

    print()
    if errors:
        print(f"FAIL: {len(errors)} error(s):", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1
    print("regenerate.py: complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
