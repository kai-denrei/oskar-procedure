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
| 2026-05-27 | Public deploy = **GitHub Pages** under the `kai-denrei` account (repo `oskar-procedure`, public). Make all cache-bust asset paths **relative** + broaden `cb-badge.js` selector so the site works under the Pages project base-path `/oskar-procedure/`. Add `.nojekyll`. | gh is authed as kai-denrei (kainode convention); the site is no-build static ESM → Pages serves it directly with zero config. Public repo required for free-tier Pages. Alternatives: Netlify/Vercel (need separate auth) rejected — Pages is zero-friction here. Relative paths over hardcoding `/oskar-procedure/` so the build is base-path-agnostic. | [[arch]] |

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
- 2026-05-27 — SYNC. Cache-busting installed (3-shape badge, token live), cb assets relocated to root. Deploying public to GitHub Pages (kai-denrei/oskar-procedure): made cb paths relative + broadened badge selector for base-path portability, added .nojekyll. Local commits at every gate (no push until now).
- 2026-05-27 — INIT. Decided cache-busting-at-scaffold (with 3-shape badge), git-init + commit-at-gates (no push), static-serve on localhost.
