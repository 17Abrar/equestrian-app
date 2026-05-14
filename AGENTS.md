# Agent Rules — Equestrian Club Management Platform

> Audit 2026-05-13 (P2): this file used to be a verbatim 1500-line
> duplicate of `CLAUDE.md` with three lines renamed (Claude Code →
> Codex). Every audit fix had to be applied twice and the two slowly
> drifted apart. Replaced with a pointer.

**Codex: read `CLAUDE.md`.** All project rules — agent behavior, coding
standards, security requirements, UI/UX, database rules, git rules,
performance, "what not to do," self-check protocol, known pitfalls,
reference docs — live there.

Wherever `CLAUDE.md` says "Claude Code," treat it as "Codex." Wherever
it points at `.claude/` for harness state, your equivalent is whatever
your harness uses for the same purpose. Otherwise the rules apply
identically.

If a rule must diverge between Claude Code and Codex, the right place
to record that is an inline `<!-- codex: … -->` callout in `CLAUDE.md`,
not a separate AGENTS.md fork.
