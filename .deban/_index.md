---
project: oskar-procedure
created: 2026-05-27
status: active
mode: solo
stale_threshold_days: 30
---

# oskar-procedure — Index

## Brief
A local, from-scratch, vanilla-ES-module recreation of Oskar Stålberg's organic
irregular quad grid (the *Townscaper* generation technique). Generate an organic all-quad
mesh (triangulate → merge → subdivide → relax), extract paintable rounded **dual cells**, and
click to paint corner-state. No framework, no build step, offline-capable, deterministic under
a seeded PRNG. Ships in gated milestones M0–M5.

**V1 (this phase) = M0 + M1 + M2** — scaffold, grid kernel, half-edge + dual cells + paint —
viewable live on localhost. M3–M5 (deformed tiles, 3D extrude, WFC) are follow-on.

## Active Roles
- [[pm]] — owner: minikai
- [[arch]] — owner: minikai
- [[dev]] — owner: minikai
- [[ux]] — owner: minikai
- [[qa]] — owner: minikai
- [[devops]] — owner: minikai

## Key Decisions
<!-- Cross-role summary, maintained by COMPACT -->
- 2026-05-27 — V1 scope fixed at M0+M1+M2 (spec's "definition of done this phase"). See [[pm]].
- 2026-05-27 — Seed = Poisson (Variant A) for M1; hex (Variant B) is optional toggle. See [[arch]].
- 2026-05-27 — Cache-busting + 3-shape visual version badge installed at scaffold time. See [[devops]].
- 2026-05-27 — Execution: lead orchestrates gated worker sub-agents (not one monolithic PM agent). See [[pm]].

## Open Questions (cross-role)
- ES modules do not load over `file://` in Chrome/Firefox — V1 needs a static server. The HANDOVER's "ideally file://" is partly unrealistic for module scripts. See [[arch]].
- Relaxation derivation orders corners **clockwise**; stage-4 normalizes winding to **CCW**. Possible sign/winding mismatch to verify empirically at M1 gate. See [[dev]].
