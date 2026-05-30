# `cmd/labs-tui/` — Operator-facing TUI (reserved for v0.2.0+)

Reserved per DR-035 § 2 A3 acting-head ratification 2026-05-29.

**Not implemented at v0.1.0.** Operator-internal view is served by the tailnet-only web hostname `labs-internal.<tailnet>` at v0.1.0 (DR-035 § 4 C1 + VP DevRel binding), which obviates the original TUI use-case.

This directory + module path is reserved so the TUI can ship at v0.2.0+ without churning the repo layout — but ONLY with validated demand signal:

- ssh-only operator workflows (e.g., debugging from a server without a browser)
- low-bandwidth contexts where the web view is impractical
- specific operator UX requests from the user

Implementation when triggered:

- Go + `tview` (matches the gastown-viewer-intent pattern)
- Reads the same content-addressed Evidence Bundle storage as the web dashboard
- Tailscale identity-gated like the web internal view (no separate auth)

Refusal-trigger reminder: do NOT ship a TUI that includes any aggregate PASS% display or any predicate-URI declaration at `labs.*` — those refusals apply to ALL surfaces of this repo (DR-035 § 8).
