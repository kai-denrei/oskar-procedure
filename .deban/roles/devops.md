---
role: devops
owner: minikai
status: active
last-updated: 2026-05-27
---

# DevOps — Tooling, Serving, Cache & Versioning

## Scope
Owns the static-serve story, git/commit-at-gates workflow, dependency vendoring, and the
cache-busting + version-confirmation toolkit.

## Decisions
| Date | Decision | Rationale | Linked roles |
|---|---|---|---|
| 2026-05-27 | Install the cache-busting toolkit at scaffold time, including the **3-shape visual version badge** (shape favicon + corner widget) for at-a-glance "did the bust work" + versioning control. | Operator requirement; cache-busting up front is cheaper than retrofitting; the shape badge gives a human a visible version signal on localhost. | [[ux]] |
| 2026-05-27 | `git init` locally; commit at each milestone gate (M0/M1/M2). **No remote push** unless operator asks. | HANDOVER "Commit at each gate". Author = Kai Denrei (kainode convention). No push not requested. | [[pm]] |
| 2026-05-27 | Serve V1 via a local static server (`python3 -m http.server` or `npx serve`) on localhost. | ES modules can't load over `file://`; localhost is what the operator asked to "look at". | [[arch]] |

## Dead Ends
<!-- APPEND ONLY. Never delete. -->
| Date | What was tried | Why it failed / was rejected |
|---|---|---|

## Lessons

## Open Questions
- [ ] Does the cache-busting service-worker pattern interfere with the iterate-and-reload dev loop (SW serving stale modules during M1 tuning)? May need SW disabled in dev, enabled for the PWA story. — owner: minikai — since: 2026-05-27

## Assumptions
- [assumption] `python3 -m http.server` serves ES modules with correct `text/javascript` MIME on this machine. — status: untested — since: 2026-05-27

## Dependencies
Blocked by:
Feeds into: [[dev]] [[ux]]

## Session Log
- 2026-05-27 — INIT. Decided cache-busting-at-scaffold (with 3-shape badge), git-init + commit-at-gates (no push), static-serve on localhost.
