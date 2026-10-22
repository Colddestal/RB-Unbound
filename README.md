# RB Unbound

**Developed by Project Poor** · Founded by [Colddestal](https://github.com/Colddestal)

*All the cards. None of the cost.*

RB Unbound is an early-stage, free, community-oriented **general-purpose digital tabletop** project. It is designed to support multiple tabletop/card games using configurable layouts and game modules, not only Riftbound. Players will manipulate pieces and resolve rules themselves.

## Current direction

- **Manual-first:** move, rotate, flip, shuffle, and organize cards without automated game-rule enforcement.
- **Two clients, one UI:** browser first; a Tauri desktop wrapper is planned.
- **Online multiplayer:** private rooms and server-synchronized tables are planned; the local prototype works without an account.
- **Game-neutral:** no copyrighted card assets or proprietary rules are bundled. A sample prototype module is included.
- **Automation later:** a generic, optional rule engine may be developed for original/authorized game modules. Automated Riftbound gameplay will not be implemented or distributed without express Riot authorization.

## Getting started

Requires Node.js 20.19+ or 22.12+ and npm.

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal. The current prototype runs **locally only**: draggable, rotatable, flippable placeholder cards and JSON table export/import. Online multiplayer is a planned milestone, not a shipped feature.

To run the optional experimental Socket.IO relay (not yet connected to the UI):

```bash
npm run dev:server
```

## Structure

- `apps/web` — React + TypeScript interface and manual tabletop prototype
- `apps/desktop` — future Tauri wrapper
- `packages/tabletop` — shared state and tabletop action contracts
- `server` — early multiplayer transport spike
- `docs/ROADMAP.md` — development plan and authorization gates
- `docs/ARCHITECTURE.md` — technical design, security and scope

## Community and donations

We intend to keep the experience free. No paywalls, paid gameplay advantages, or in-game purchases are planned. Any donations and public distribution involving third-party game IP are subject to the applicable permissions and policies.

## Riot / Riftbound authorization

Project Poor has submitted a Riot Developer Portal application for review. **URL verification and application submission do not constitute authorization.** Riot's published policy currently does not approve automated Riftbound gameplay or standalone Riftbound-only clients. Any Riftbound-specific integration, card data, artwork, branding, or public distribution requires an appropriate review of Riot's terms and permissions. No Riot-owned assets are included in this repository.

## Status

Alpha foundation: original placeholder tabletop interface and TypeScript workspace. Not production-ready. No account system or public multiplayer has been released.

## License

**Not selected yet.** Until a license is chosen, this repository does not grant general permission to reuse its code. Third-party assets would require separate rights regardless of future software license.

## Disclaimer

Independent, unofficial community project; not affiliated with, endorsed by, or sponsored by Riot Games.
