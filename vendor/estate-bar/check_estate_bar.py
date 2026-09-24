#!/usr/bin/env python3
"""Fail if a site's estate bar differs from the canonical one.

Stdlib only, so it runs in any repo's CI. Two checks:
  1. The vendored canonical files match manifest.sha256 (nobody hand-edited them).
  2. Every given HTML file contains exactly one estate-bar block, and that block
     equals the canonical fragment for the site (indentation-insensitive).

  check_estate_bar.py --site demos --vendor path/to/estate-bar site/index.html ...
  check_estate_bar.py --site labs  --vendor vendor/estate-bar --glob 'site/**/*.html' \
                      --exempt 'site/embed/**'
"""
import argparse, fnmatch, glob, hashlib, re, sys
from pathlib import Path

BLOCK = re.compile(r"<!-- estate-bar:start[^>]*-->.*?<!-- estate-bar:end -->", re.S)


def norm(s: str) -> str:
    return "\n".join(line.strip() for line in s.strip().splitlines() if line.strip())


def verify_manifest(vendor: Path) -> list[str]:
    errors = []
    manifest = vendor / "manifest.sha256"
    if not manifest.is_file():
        return [f"{manifest}: missing"]
    for line in manifest.read_text().splitlines():
        digest, _, rel = line.partition("  ")
        target = vendor / rel
        if not target.is_file():
            errors.append(f"{target}: listed in manifest but missing")
        elif hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            errors.append(f"{target}: differs from manifest (vendored copy was edited; re-sync it)")
    return errors


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", required=True)
    ap.add_argument("--vendor", required=True, type=Path)
    ap.add_argument("--glob", action="append", default=[])
    ap.add_argument("--exempt", action="append", default=[])
    ap.add_argument("files", nargs="*")
    a = ap.parse_args()

    errors = verify_manifest(a.vendor)
    fragment = a.vendor / "fragments" / f"estate-bar.{a.site}.html"
    if not fragment.is_file():
        print(f"estate-bar: no canonical fragment for site '{a.site}' at {fragment}", file=sys.stderr)
        return 2
    expected = norm(fragment.read_text())

    files = list(a.files)
    for pattern in a.glob:
        files += glob.glob(pattern, recursive=True)
    files = sorted({f for f in files if not any(fnmatch.fnmatch(f, e) for e in a.exempt)})
    if not files:
        errors.append("no HTML files matched; a check that inspects nothing must not pass")

    for f in files:
        blocks = BLOCK.findall(Path(f).read_text(encoding="utf-8", errors="replace"))
        if len(blocks) != 1:
            errors.append(f"{f}: expected exactly 1 estate-bar block, found {len(blocks)}")
        elif norm(blocks[0]) != expected:
            errors.append(f"{f}: estate bar differs from canonical fragment for '{a.site}'")

    for e in errors[:40]:
        print(f"FAIL {e}", file=sys.stderr)
    if len(errors) > 40:
        print(f"... and {len(errors) - 40} more", file=sys.stderr)
    if errors:
        return 1
    print(f"estate-bar: {len(files)} file(s) match canonical '{a.site}' bar; vendored files match manifest")
    return 0


if __name__ == "__main__":
    sys.exit(main())
