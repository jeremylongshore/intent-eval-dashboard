#!/usr/bin/env bash
# Vendor the canonical Intent Solutions estate bar.
#
# The bar's single source is intent-solutions-landing/estate-bar/. This copies it
# at a pinned commit into vendor/estate-bar/ (verified against the canonical
# manifest), then publishes only the stylesheet and font into site/estate-bar/
# and site-evals/estate-bar/ (labs and evals are separate origins served from
# this one checkout). The HTML fragments stay out of the served trees on
# purpose: every *.html under site/ is treated as a public page by the header
# sync, the C3 lint and the tests. Never hand-edit any copy; the estate bar test
# fails if they stop matching the manifest.
#
#   scripts/sync-estate-bar.sh                 # latest main
#   scripts/sync-estate-bar.sh <commit-sha>    # a specific commit
set -euo pipefail
repo="jeremylongshore/intent-solutions-landing"
ref="${1:-main}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
vendor="$root/vendor/estate-bar"

sha="$(curl -fsSL "https://api.github.com/repos/$repo/commits/$ref" | python3 -c 'import json,sys; print(json.load(sys.stdin)["sha"])')"
base="https://raw.githubusercontent.com/$repo/$sha/estate-bar"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

curl -fsSL "$base/manifest.sha256" -o "$tmp/manifest.sha256"
while read -r _digest rel; do
  mkdir -p "$tmp/$(dirname "$rel")"
  curl -fsSL "$base/$rel" -o "$tmp/$rel"
done < "$tmp/manifest.sha256"
for extra in check_estate_bar.py fonts/OFL.txt; do
  mkdir -p "$tmp/$(dirname "$extra")"
  curl -fsSL "$base/$extra" -o "$tmp/$extra"
done
(cd "$tmp" && sha256sum --check --quiet manifest.sha256)

rm -rf "$vendor"; mkdir -p "$vendor"
cp -a "$tmp/." "$vendor/"
printf 'source: https://github.com/%s/tree/%s/estate-bar\ncommit: %s\n' "$repo" "$sha" "$sha" > "$vendor/SOURCE"
for served in "$root/site/estate-bar" "$root/site-evals/estate-bar"; do
  rm -rf "$served"; mkdir -p "$served/fonts"
  cp "$vendor/estate-bar.css" "$served/estate-bar.css"
  cp "$vendor/fonts/JetBrainsMono-Medium.woff2" "$served/fonts/"
done
echo "estate bar vendored from $repo@$sha"
