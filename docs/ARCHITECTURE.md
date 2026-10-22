# Architecture and scope

## Guiding decisions

1. **Real multi-game platform.** The tabletop core is game-agnostic. Game modules will define their own layout and original/authorized assets.
2. **Manual rules only for the initial release.** Moving a piece changes shared tabletop state; software does not determine legality or resolve card effects.
3. **Single shared client UI.** React/TypeScript for web, and a future Tauri wrapper for desktop.
4. **Server-authoritative multiplayer later.** Never trust a connected client to reveal hidden cards or decide another player's permissions.
5. **Riot authorization is separate.** No game-specific Riftbound integration until the necessary rights are clear.

## Workspace

- `apps/web`: presentation and local table interactions.
- `packages/tabletop`: serializable state, validation and action transformations.
- `server`: future Socket.IO rooms. The current example relay is an **experiment** and must not be internet-exposed as a production game server.
- `apps/desktop`: reserved for Tauri when web is stable.

## Typical action (future multiplayer)

`client input -> action schema validation -> authorization -> server state mutation -> per-viewer filtered update -> synchronized UI`

Current alpha demonstrates local-only state changes; do not confuse it with the production networking architecture.

## Multiplayer lobby model

Rooms are designed around four seats from the start.

- `1v1`: seats 1 and 2 are required.
- `2v2`: seats 1 and 3 form one team; seats 2 and 4 form the other.
- `ffa4`: all four seats are independent.
- Room owners choose Standard, Unrestricted, or Custom ruleset presets.
- Room owners may change settings only before the match starts.
- A normal start requires all required players to be ready when ready checks are enabled.
- A force-start is owner-only and is allowed only when every required seat is occupied.
- Lobby chat is room-scoped and bounded; production rate limiting/moderation remains future work.
- Internal connection identifiers are not included in public room snapshots.

## Hidden information and security backlog

Hands and deck order must only be visible to authorized players. Implement per-viewer projections, secure random shuffles on the server, durable sessions, action rate limits, moderation, abuse logging, state version checks and message size limits before public multiplayer.

## Rules engine boundary

Future authorized automation should be an optional separate module implementing a well-defined game-specific rules interface. Manual tabletop code must not depend on it.


## Live match synchronization

The development server now owns the canonical tabletop state for active rooms. Browser clients send intent only; the server derives the acting seat from the connection and ignores any client attempt to choose another actor.

Deck shuffles are generated server-side with Node's cryptographic random source. Multiplayer projections never send deck identities/order to clients. A player receives identities for their own hand plus public field/discard information. Opponent hands and all decks are represented only by counts; face-down public cards have their identity redacted for unauthorized viewers.

The current match state is in memory and is not durable. Reconnect/session recovery, action sequence numbers, persistence and horizontal scaling remain future work.


## Reconnect and action sequencing

The server now issues an opaque 256-bit session token when a player creates or joins a room. The browser stores only this token in session storage and presents it again after a refresh or temporary disconnect. The server maps the token back to the stable room member identity and seat; clients do not choose their own member identifiers.

Disconnected lobby sessions are retained for a limited recovery window. Active-match seats remain reserved for the session so a transient disconnect cannot be used to steal a seat.

Match actions carry a monotonically increasing per-member sequence number. The server records the last accepted sequence and rejects duplicate or out-of-order actions while continuing to serialize all room state changes on the authoritative server. Match updates include a server revision counter for diagnostics and later persistence/replay work.

Reconnect does not yet survive a server restart because room, match and session state are still in memory.


## Development persistence and restart recovery

The development multiplayer server now writes atomic snapshots to `.data/server-state.json` by default (configurable with `RB_UNBOUND_STATE_PATH`). Room state, canonical match state, action sequence history and resumable session metadata are restored on server startup.

Reconnect credentials are not stored in plaintext. The browser keeps the opaque raw token while the server persists only its SHA-256 hash. After a restart, presenting the same raw token allows the server to hash it again and locate the restored session.

Snapshots are written through a temporary file followed by an atomic rename, are excluded from Git, and are flushed on SIGINT/SIGTERM. This file-backed store is intentionally a development durability layer, not the planned production database. Production hosting will move durable state to a database and add backups, migrations, expiration policies and multi-instance coordination.


## Rate limits and anti-abuse controls

All inbound Socket.IO events now pass through server-side token-bucket rate limiting before their handlers run. Limits are tuned by event class: room creation/settings and chat are conservative, while live match actions use a much higher burst/refill allowance so normal drag movement remains responsive.

The server also applies per-event serialized payload-size limits in addition to Socket.IO's global message-size cap. Repeated violations are tracked per stable member identity when available, and a client that repeatedly exceeds limits is disconnected.

These controls are an initial abuse-resistance layer. Production still requires IP/proxy-aware connection limiting, authentication-backed identity, moderation tools, audit logging, metrics/alerting, and infrastructure-level protections.


## Card inspector UI

The tabletop now reserves a left-side information panel for card inspection. Hovering a visible card shows a temporary preview; clicking pins that card until another card is clicked or the pin is cleared. The same component is shared by local play, multiplayer and spectator views.

The inspector only renders information already present in the current client view. In multiplayer it cannot reveal hidden hand/deck identities because those values are filtered by the server before the client receives them. Future game modules can enrich this panel with authorized card art, rules text, stats and metadata without changing the interaction model.
