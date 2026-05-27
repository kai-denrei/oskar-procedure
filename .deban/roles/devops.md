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
| 2026-05-27 | **PWA by hand** (no Vite/Workbox/npm — the mobile-pwa skill's default stack violates the no-build constraint). Token-keyed `sw.js`, NetworkFirst for app code + CacheFirst for static, consent update-toast, manifest + iOS tags + Chrome-rendered PNG icons. `bust.sh` extended to bump the SW token. | Operator's recurring pain is stale cache; a hand SW keyed to the bust token makes invalidation explicit and reliable rather than pinning old builds. Workbox/Vite rejected: would require a build step (forbidden). Icons via headless Chrome because libcairo/cairosvg is unavailable on this machine. | [[ux]] [[arch]] |

## Dead Ends
<!-- APPEND ONLY. Never delete. -->
| Date | What was tried | Why it failed / was rejected |
|---|---|---|
| 2026-05-28 | Cache-busting that fingerprints only the HTML entry (`main.js?v=`), trusting the SW's NetworkFirst to keep modules fresh. | The ES-module **import graph** (`main.js` imports `./grid.js`, etc.) carried NO `?v=`. With GitHub Pages `max-age=600`, a device ran fresh `index.html` + fresh `main.js` but a **10-min-cached old `grid.js`** → the H1 boundary-pin fix (correct, deployed, 99 tests) didn't reach the operator; the hexagon still relaxed its boundary. SW NetworkFirst doesn't save you: `fetch()` inside the SW still hits the browser HTTP cache. Fix: fingerprint the whole import graph (`scripts/fingerprint-imports.py`, wired into `bust.sh`) so every module is a unique URL per build; plus SW navigation `cache:'reload'` so the entry revalidates and new module URLs propagate at once. |

## Lessons
- **Fingerprint the whole module graph, not just the entry.** A no-build ES-module app's `import './x.js'` specifiers are cache keys too — unfingerprinted, a stale module hides behind a fresh entry, and NetworkFirst won't catch it (the SW's own `fetch` reads the HTTP cache). Unique per-build URLs on every module is the only airtight fix. — from dead end on 2026-05-28

## Open Questions
- [x] RESOLVED 2026-05-27: SW does NOT pin stale builds. App code uses **NetworkFirst** (always tries network first → fresh in dev), the cache name is **keyed to the cache-bust token** (`oskar-${CB_TOKEN}`, bumped by `bust.sh`), old caches are deleted on activate, and a **consent toast** gates `skipWaiting`. Verified offline: with the server killed, the warmed profile rendered the full app from cache. Stale-pinning (the usual SW failure mode) is structurally prevented. — owner: minikai — since: 2026-05-27

## Assumptions
- [assumption] `python3 -m http.server` serves ES modules with correct `text/javascript` MIME on this machine. — status: untested — since: 2026-05-27

## Dependencies
Blocked by:
Feeds into: [[dev]] [[ux]]

## Session Log
- 2026-05-27 — SYNC. Cache-busting installed (3-shape badge, token live), cb assets relocated to root. Deploying public to GitHub Pages (kai-denrei/oskar-procedure): made cb paths relative + broadened badge selector for base-path portability, added .nojekyll. Local commits at every gate (no push until now).
- 2026-05-27 — INIT. Decided cache-busting-at-scaffold (with 3-shape badge), git-init + commit-at-gates (no push), static-serve on localhost.
