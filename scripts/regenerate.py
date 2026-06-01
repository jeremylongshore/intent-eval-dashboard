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
        upstream_label = f'{upstream["owner"]}/{upstream["repo"]}@{upstream.get("branch", "main")}'
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
                    version <code data-auto="version">{version}</code> · last changed <code data-auto="last_changed_at">{last_changed}</code> · source <code>{upstream_label}</code>
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
            meta_bits.append(f'version <code data-auto="version">{version}</code>')
        if last_changed:
            meta_bits.append(
                f'last changed <code data-auto="last_changed_at">{last_changed}</code>'
            )
        attestation = sc.get("attestation_status", "")
        if attestation:
            meta_bits.append(f"attestation <code>{attestation}</code>")
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

    queued_items = []
    for q in manifest.get("queued_for_v0_2_0", []):
        upstream = q["upstream"]
        upstream_label = f'{upstream["owner"]}/{upstream["repo"]}'
        queued_items.append(
            f'            <li><strong>{q["title"]}</strong> ({upstream_label}) — {q["short_description"]}</li>'
        )
    queued_block = "\n".join(queued_items)

    return LISTING_TEMPLATE.format(
        eval_list=eval_list_block,
        scorecards_list=scorecards_block,
        queued_list=queued_block,
        cron_last_run_utc=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    )


LISTING_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Eval Sets — Intent Eval Platform</title>
    <meta name="description" content="Versioned, lineage-tracked specifications of what the Intent Eval Platform measures. The eval-set is the spec.">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="https://labs.intentsolutions.io/eval-sets/">
    <link rel="stylesheet" href="/style.css">

    <meta property="og:title" content="Eval Sets — Intent Eval Platform">
    <meta property="og:description" content="Versioned specifications of what we measure. The eval-set is the spec.">
    <meta property="og:url" content="https://labs.intentsolutions.io/eval-sets/">
    <meta property="og:type" content="website">

    <meta name="iep-source-repo" content="github.com/jeremylongshore/intent-eval-dashboard">
    <meta name="iep-dashboard-version" content="0.1.0">
    <meta name="iep-cron-last-run" content="{cron_last_run_utc}">
</head>
<body>
    <header class="site-header">
        <div class="site-header__inner">
            <a href="/" class="site-header__wordmark">IEP&nbsp;Labs</a>
            <nav class="site-nav" aria-label="Primary">
                <a href="/eval-sets/" aria-current="page">Eval Sets</a>
                <a href="/methodology/">Methodology</a>
                <a href="https://github.com/jeremylongshore/intent-eval-dashboard">GitHub</a>
            </nav>
        </div>
    </header>

    <main>
        <h1>Eval Sets</h1>

        <p class="lead">
            Versioned, lineage-tracked specifications of what the Intent Eval Platform measures. The eval-set is the spec — every signed Evidence Bundle is an attestation about conformance to one of these.
        </p>

        <p>
            Each eval-set is a complete document: its definition, its version history, its lineage to any predecessor, a pointer to an adversarial audit (when one exists), and the full list of tests it includes. Lineage is content-addressed so a hash mismatch breaks renderings of older runs against newer eval-sets.
        </p>

        <h2>How to read this page</h2>

        <p>
            An eval-set tagged <span class="badge badge--active">active</span> is the currently authoritative version. A <span class="badge badge--draft">draft</span> tag means the methodology is open for review and the predicate URI it would attest against is reserved but not yet declared. A <span class="badge badge--deprecated">deprecated</span> tag means a successor eval-set has replaced it; renderings of old runs against deprecated eval-sets are preserved for the audit trail but marked.
        </p>

        <h2>Current eval-sets</h2>

        <ul class="eval-list">
{eval_list}
        </ul>

        <h2>Scorecards</h2>

        <p>
            A scorecard is a <em>result</em>, not a spec. Each row is a measurement of one
            system against an eval-set, built to ship as a signed, Rekor-anchored Evidence
            Bundle. The eval-set above defines <em>what</em> is measured; a scorecard records
            <em>what happened</em> when something was measured against it. We keep them separate
            so a result is never mistaken for the specification it was measured against.
        </p>

        <ul class="eval-list">
{scorecards_list}
        </ul>

        <h2>Coming next</h2>

        <p>
            These eval-sets are queued for v0.2.0 publication once their authoring lands upstream:
        </p>

        <ul>
{queued_list}
        </ul>

        <p>
            Neither will be published here until its specification is complete, its lineage is recorded, and an adversarial audit has been documented. We refuse to publish demo or skeleton eval-sets that would become the canonical example of a predicate URI before the methodology is sound.
        </p>

        <h2>How to contribute</h2>

        <p>
            Eval-sets are authored upstream in the repo they measure. Open an issue or pull request against the source repos linked above. When a new eval-set is ratified, it lands here automatically on the next daily cron refresh.
        </p>
    </main>

    <footer class="site-footer">
        <div class="site-footer__inner">
            <div>
                <strong>labs.intentsolutions.io</strong> · dashboard <code>v0.1.0</code> · cron last ran <code>{cron_last_run_utc}</code><br>
                Intent Solutions — <a href="https://intentsolutions.io">intentsolutions.io</a>
            </div>
            <div>
                <a href="/methodology/">Methodology</a> ·
                <a href="/eval-sets/">Eval Sets</a> ·
                <a href="https://github.com/jeremylongshore/intent-eval-dashboard">GitHub</a>
            </div>
        </div>
    </footer>
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
