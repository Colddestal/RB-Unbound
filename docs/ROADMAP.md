# RB Unbound — Development Roadmap

## Phase 0 — Foundation
- [x] Choose name RB Unbound, Project Poor, and founder identity Colddestal
- [x] Create GitHub repository and GitHub Pages verification site
- [x] Submit Riot application and verify product URL (decision pending)
- [x] Refresh project README and architecture for manual-first, multi-game approach (prepared in this change)
- [ ] Merge foundation pull request
- [ ] Choose a software license for our original code
- [ ] Ask Riot how to amend the application to describe manual-play and multiple supported games

## Phase 1 — Local manual tabletop (first shipped prototype)
- [x] React/TypeScript/Vite workspace and original sample card set
- [x] Drag, flip, rotate placeholder cards
- [x] Save/export and import tabletop state as JSON
- [ ] Add decks, hands, discard piles, shuffle, card stacks, and ownership controls
- [ ] Accessibility, PC keyboard interaction, automated UI tests
- [ ] Polish desktop board layout and mouse interactions

## Phase 2 — Multiplayer
- [x] Isolated Socket.IO relay starter (experimental; not yet connected to the UI)
- [ ] Authoritative room state; authenticated actions and validation
- [ ] Hidden information filtered per player and spectator
- [ ] Join/invite codes, reconnect, anti-abuse controls
- [ ] Durable snapshots, reliable action sequencing, tests

## Phase 3 — Multi-game platform
- [x] Document versioned module schema and sandbox constraints
- [x] Support at least two independent original game modules
- [x] Configurable board zones and card backs
- [x] Game-agnostic deck import and search

## Phase 4 — Desktop and operations
- [ ] Tauri desktop wrapper and Windows builds
- [ ] Cross-client multiplayer testing
- [ ] CI build/release workflow, signing and updates
- [ ] Privacy policy, terms, moderation and security hardening
- [ ] Production hosting and cost controls

## Authorization gates
- [ ] Written approval for any proposed Riftbound-specific manual module and assets, where required
- [ ] Explicit separate written authorization before considering automated Riftbound gameplay
- [ ] Donation implementation reviewed for compliance with applicable policies

**No Riftbound-specific assets or automated Riftbound rules are included in the starter.**
