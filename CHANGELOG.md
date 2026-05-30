# Changelog

All notable changes to `intent-eval-dashboard` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial repository scaffolding per DR-035 (ISEDC Session 8, ratified 2026-05-29)
- README, CLAUDE.md, governance docs, license, contributor docs
- Reserved directories: `site/` (static HTML pages at Phase 1 Epic 1.3), `cmd/labs-tui/` (Go TUI at v0.2.0+ pending validated demand)
- `tests/TESTING.md` skeleton per IS Testing SOP
- Vendored `@intentsolutions/audit-harness` as dev dep
- Partner-portals-pattern deploy workflow template (placeholder until Epic 1.3 ships site/)

### Changed

- **Site format:** single-file HTML per page at v0.1.0 (Claude-generated self-contained HTML + shared `/style.css`), replacing the original plan-rank choice of Astro. Astro adopted at Phase 2 when interactive surfaces arrive (results browser + freshness strip). Acting-head decision 2026-05-30; recorded in `~/.claude/plans/intent-solutions-lab-reports-amber-lighthouse.md` § 3 Epic 1.3. DR-035 binding decisions unaffected (site generator was a plan-level choice, not a council-ratified item).

### Tracking

- bd epic: `bd_000-projects-puxu`
- GH umbrella issue: TBD on first push
- Plan: `~/.claude/plans/intent-solutions-lab-reports-amber-lighthouse.md`
- DR: `intent-eval-lab/000-docs/035-AT-DECR-isedc-council-session-8-labs-dashboard-2026-05-29.md`
