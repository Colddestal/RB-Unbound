# RB Unbound

**Developed by Project Poor** · Founded by [Colddestal](https://github.com/Colddestal)

*All the cards. None of the cost.*

RB Unbound is an early-stage, free, community-oriented **general-purpose digital tabletop** project. It is designed to support multiple tabletop/card games using configurable layouts and game modules, not only Riftbound. Players will manipulate pieces and resolve rules themselves.

## Current direction

- **Manual-first:** move, rotate, flip, shuffle, and organize cards without automated game-rule enforcement.
- **Two clients, one UI:** browser first; a Tauri desktop wrapper is planned.
- **Multiplayer alpha:** private rooms and server-synchronized tables run from the desktop host. Local tabletop play still works without an account.
- **Game-neutral:** no copyrighted card assets or proprietary rules are bundled. A sample prototype module is included.
- **Automation later:** a generic, optional rule engine may be developed for original/authorized game modules. Automated Riftbound gameplay will not be implemented or distributed without express Riot authorization.

## Getting started

The playable local sandbox is also published at [the browser demo](https://colddestal.github.io/RB-Unbound/demo/). The root GitHub Pages URL remains the project and Riot verification page. The hosted demo is static; account decks and multiplayer need the desktop host.

To rebuild the checked-in GitHub Pages demo after changing the web app, run `npm install` and `npm run build:demo`, then commit the updated `demo/` files.

Requires Node.js 20.19+ or 22.12+ and npm.

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal. The Home dashboard links to the local tabletop, deck editor, deck discovery, and multiplayer rooms. Local play supports manual card movement and turns. The duel mat has an End Turn button with confirmation, while its keyboard shortcut guide sits below the mat. Choose the separate **Deck editor** tab to build with original sample cards. Its **Decks** menu holds multiple named decks and a create button. The Full Mat Prototype editor has Legend, Runes, Champion, Deck, Side deck, and Battlefields sections, affinity and character-name checks, counts, and actionable warnings. The right-side list shows each card's color markings; hover or focus a listed card to see its larger face and sample text. A sample starter uses 1 dual-affinity Legend, 12 Runes, 1 matching Champion, 39 main cards, and 3 different Battlefields; up to 8 side cards can be kept in the editor but are not laid on the table. These are prototype limits, not official Riftbound deck validation. You can export an unfinished draft, import an app-generated JSON deck, and test a valid draft on either local seat. Guest decks remain in that browser; sign in to store decks with your account on the desktop host.

The built-in catalog still contains original placeholder cards. Official Riftbound cards and art require Riot-approved app-specific API access; the generic editor is ready for an authorized catalog but does not ship one.

To run the multiplayer development server in another terminal:

```bash
npm run dev:server
```

## Host a temporary test site from a Windows desktop

The desktop can serve the built website and multiplayer rooms from one address. This is separate from the GitHub Pages demo URL.

For the usual Windows setup, double-click **`Start-RB-Unbound.cmd`** in the repository folder. It finds `cloudflared-windows-amd64.exe` in your Downloads folder (or next to the launcher), builds and starts the game server, waits for it to be ready, then opens Cloudflare Tunnel in a second window. The public `https://...trycloudflare.com` link appears in the Cloudflare window. If a game server or tunnel is already running, the launcher reuses it. Keep both windows open while playing. After pulling an update, close the old game server window with Ctrl+C before using the launcher to rebuild it.

To start the server manually instead:

```cmd
cd /d "C:\Users\willi\Documents\GitHub\RB-Unbound"
npm ci --include=optional
npm run host:site
```

The first command assumes that is where GitHub Desktop checked out the repository. After later pulls, `npm ci` is only needed if dependencies changed. Leave this window open and test `http://127.0.0.1:3001/` on the host desktop.

Players can create a username and password from **Sign in → Create an account**. No email is requested, and the username, password hash, and deck library are stored in `.data/accounts.json` on this host. There is no email password reset, so keep the password and back up that file. When the temporary tunnel address changes, sign in again at the new address; browser sign-in tokens belong to the old address.

New account decks are public on this host by default. Check **Private deck** in the editor to remove one from **Discover decks**. Existing decks and auto-created starter decks stay private until their owners uncheck that box. Discovery lists public decks by name, author, and module; anyone visiting the host can view their card lists, and signed-in players can copy one into their own editable library. Only the owner can edit or change visibility of the original. Browser-only decks remain local and cannot appear in Discovery.

Once everyone readies in the room, each player locks in an account deck. Seats 1 and 2 then choose one of their three Battlefields from their hand; seat 1 fills A and seat 2 fills B. Their unchosen Battlefields leave the table. Every player draws four cards and may replace up to two from the top of their deck before regular turns begin. The Battlefield artwork and effect text are visible on the mat; prototype effects are resolved manually. Undo and Redo buttons below the board (Q / E) can step through any number of your card changes. In multiplayer, only the active player can use them; a new card change clears the redo path.

For friends outside the home network, install [Cloudflare's Windows cloudflared](https://developers.cloudflare.com/tunnel/downloads/). If starting the tunnel manually, run this in a **second** Command Prompt:

```cmd
"%USERPROFILE%\Downloads\cloudflared-windows-amd64.exe" tunnel --url http://127.0.0.1:3001
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

Alpha foundation: original placeholder tabletop interface, TypeScript workspace, desktop-hosted accounts, and multiplayer room setup. The temporary tunnel is for testing, not an always-on public service.

## License

**Not selected yet.** Until a license is chosen, this repository does not grant general permission to reuse its code. Third-party assets would require separate rights regardless of future software license.

## Disclaimer

Independent, unofficial community project; not affiliated with, endorsed by, or sponsored by Riot Games.
