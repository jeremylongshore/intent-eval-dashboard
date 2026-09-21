#!/usr/bin/env python3
"""Put the canonical estate bar into the hand-authored evals pages. Idempotent.

evals.intentsolutions.io is served from site-evals/: the registry home plus one
page per predicate. They are hand-written HTML with inline styles, not generated,
so the labs header sync never reached them and they drifted (the predicate pages
carried a three-link strip with no Demos). This replaces each page's old strip
with the canonical evals fragment and links the published stylesheet.

    python3 scripts/stamp-evals-estate-bar.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRAGMENT = (ROOT / "vendor/estate-bar/fragments/estate-bar.evals.html").read_text().strip()
# prettier formats site-evals/ and would re-wrap the anchors; the canonical
# checker compares the block verbatim, so the block is fenced off from prettier.
BAR = "<!-- prettier-ignore -->\n" + FRAGMENT
LINK = '<link rel="stylesheet" href="/estate-bar/estate-bar.css" />'
ACCENT = ".is-estate-bar {\n        --estate-accent: #f08a4b;\n      }"

EXISTING = re.compile(r"(?:<!-- prettier-ignore -->\s*)?<!-- estate-bar:start[^>]*-->.*?<!-- estate-bar:end -->", re.S)
OLD_HOME = re.compile(r'<header class="network".*?</header>', re.S)
OLD_PREDICATE = re.compile(r"(<body>\s*)<header\s+style=.*?</header>", re.S)
OLD_CSS = re.compile(r"\n[ \t]*\.network(?:__[a-z]+)?[^{]*\{[^}]*\}", re.S)


def indent(block: str, spaces: int) -> str:
    return "\n".join((" " * spaces + line) if line else line for line in block.splitlines())


def stamp(path: Path) -> str:
    html = path.read_text(encoding="utf-8")
    original = html
    bar = indent(BAR, 4).lstrip()
    if EXISTING.search(html):
        html = EXISTING.sub(lambda _m: bar, html, count=1)
    elif OLD_HOME.search(html):
        html = OLD_HOME.sub(lambda _m: bar, html, count=1)
    elif OLD_PREDICATE.search(html):
        html = OLD_PREDICATE.sub(lambda m: m.group(1) + bar, html, count=1)
    else:
        raise SystemExit(f"{path}: no network strip found to replace")
    html = OLD_CSS.sub("", html)
    if "/estate-bar/estate-bar.css" not in html:
        html = html.replace("<style>", f"{LINK}\n    <style>\n      {ACCENT}", 1)
    if html != original:
        path.write_text(html, encoding="utf-8")
        return "stamped"
    return "already current"


if __name__ == "__main__":
    for page in sorted((ROOT / "site-evals").rglob("*.html")):
        print(f"{stamp(page)}: {page.relative_to(ROOT)}")
