# RB Unbound

**Developed by Project Poor** · Founded by [Colddestal](https://github.com/Colddestal)

*All the cards. None of the cost.*

RB Unbound is an early-stage, free, community-oriented **general-purpose digital tabletop** project. It is designed to support multiple tabletop/card games using configurable layouts and game modules, not only Riftbound. Players will manipulate pieces and resolve rules themselves.

## Current direction

- **Manual-first:** move, rotate, flip, shuffle, and organize cards without automated game-rule enforcement.
- **Two clients, one UI:** browser first; a Tauri desktop wrapper is planned.
- **Multiplayer alpha:** private rooms and server-synchronized tables work with the development server; public hosting is still planned. The local tabletop works without an account.
- **Game-neutral:** no copyrighted card assets or proprietary rules are bundled. A sample prototype module is included.
- **Automation later:** a generic, optional rule engine may be developed for original/authorized game modules. Automated Riftbound gameplay will not be implemented or distributed without express Riot authorization.

## Getting started

The playable local sandbox is also published at [the browser demo](https://colddestal.github.io/RB-Unbound/demo/). The root GitHub Pages URL remains the project and Riot verification page. The hosted demo is static; multiplayer needs the separate local server until production hosting is ready.

To rebuild the checked-in GitHub Pages demo after changing the web app, run `npm install` and `npm run build:demo`, then commit the updated `demo/` files.

Requires Node.js 20.19+ or 22.12+ and npm.

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal. The Home dashboard links to the local tabletop, deck editor, and multiplayer rooms. Local play supports manual card movement and turns. The duel mat has an End Turn button with confirmation, while its keyboard shortcut guide sits below the mat. Choose the separate **Deck editor** tab to build with original sample cards. The Full Mat Prototype editor has Legend, Runes, Champion, Deck, and Side deck sections, affinity and character-name checks, counts, and actionable warnings. The right-side list shows each card's color markings; hover or focus a listed card to see its larger face and sample text. A sample starter uses 1 dual-affinity Legend, 12 Runes, 1 matching Champion, 39 other main cards, and up to 8 optional side cards. These are prototype limits, not official Riftbound deck validation. You can export an unfinished draft, import an app-generated JSON deck, and load a valid draft onto the local table's matching piles. Each player has a separate browser-saved draft; export a copy before clearing browser data. The browser demo hosts local play, while multiplayer requires a running development server.

The built-in catalog still contains original placeholder cards. Official Riftbound cards and art require Riot-approved app-specific API access; the generic editor is ready for an authorized catalog but does not ship one.

To run the multiplayer development server in another terminal:

```bash
npm run dev:server
```

## Host a temporary test site from a Windows desktop

The desktop can serve the built website and multiplayer rooms from one address. This is separate from the GitHub Pages demo URL. In **Command Prompt** (copy commands only, without the `C:\...>` prompt):

```cmd
cd /d "C:\Users\willi\Documents\GitHub\RB-Unbound"
npm ci --include=optional
npm run host:site
```

The first command assumes that is where GitHub Desktop checked out the repository. After later pulls, `npm ci` is only needed if dependencies changed. Leave this window open and test `http://127.0.0.1:3001/` on the host desktop.

For friends outside the home network, install [Cloudflare's Windows cloudflared](https://developers.cloudflare.com/tunnel/downloads/). In a **second** Command Prompt, run:

```cmd
cloudflared tunnel --url http://127.0.0.1:3001
```

Open the temporary `https://...trycloudflare.com` address printed by cloudflared. Share **that address** with players; the site and multiplayer socket use the same secure origin. Keep both windows open and the computer awake. This test URL changes each time the tunnel restarts, and anyone with the link can reach the test site. No router port forwarding or inbound Windows Firewall rule is needed. Stop sharing by pressing Ctrl+C in the tunnel window.

This is a temporary alpha test, not an always-on public deployment. Match snapshots are stored locally on the desktop. The GitHub Pages demo continues to host only local play and does not connect to this temporary tunnel.

## Structure

- `apps/web` — React + TypeScript interface and manual tabletop prototype
- `apps/desktop` — future Tauri wrapper
- `packages/tabletop` — shared state and tabletop action contracts
- `server` — private-room multiplayer alpha server
- `deploy/README.md` — private Linux server setup and unattended GitHub updates
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
