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


## Private rooms and invite access

A room has a six-character room code used as its identifier. Public rooms currently allow joins with that room code alone. Private rooms additionally require an eight-character invite code generated by the server.

The raw invite code is sent only to the room owner and cached locally by that owner's browser for redisplay after reconnect. The server stores only a SHA-256-derived invite-code hash in persisted room state and compares submitted codes without exposing the hash through public room snapshots.

Changing a public lobby to private generates a new invite code. Changing a private lobby to public removes the stored invite requirement. Reconnect sessions already authorized for a room do not need to resubmit an invite code.

"Public" does not yet imply room discovery; a public room browser is a separate future feature.


## 2v2 team-aware visibility

Team-private information is configurable rather than assumed. In 2v2 rooms the host may enable **Share teammate hands** before the match starts. When enabled, each player receives card identities for their own hand and their teammate's hand; the teammate hand is rendered read-only and cannot be manipulated by the other player.

Opponents never receive those private hand identities, spectators receive no private hands, and deck identities/order remain server-only regardless of the sharing setting. The setting is disabled automatically outside 2v2 formats.


## Versioned game-module schema

RB Unbound game modules use a declarative schema rather than executable plugin code. Schema version 1 defines module identity/version, supported match formats, board zones, card-back descriptors and optional card metadata fields.

The schema is intentionally bounded:
- stable lowercase IDs
- at most 32 zones
- at most 16 card backs
- at most 32 card metadata fields
- normalized tabletop coordinates within the core 1000×600 space
- known zone kinds, visibility hints and card-back patterns only

### Module sandbox boundary

A module definition is data, not code. Version 1 does **not** allow:
- JavaScript callbacks
- arbitrary rules functions
- network requests
- filesystem access
- dynamic imports
- DOM manipulation
- automatic game-rule execution

Future game-specific automation, where legally and technically appropriate, must live behind a separate explicitly reviewed rules-engine interface. The base module format remains portable, inspectable and safe to validate before use.

The built-in `generic-duel` module is original placeholder content used to prove the schema without incorporating third-party game assets or rules.


## Module-driven tabletop presentation

The local tabletop can now switch between built-in game modules without changing the core tabletop implementation. The active module supplies zone labels and card-back presentation descriptors.

The first two built-in original modules are:
- `generic-duel`
- `frontier-skirmish`

For this stage, the underlying tabletop state still uses the core zone identifiers `deck`, `hand`, `field`, and `discard`. Modules map presentation onto those core zone kinds rather than redefining serialized card state. This intentionally separates UI/module proof from a larger state-schema migration.

The next expansion can move module-defined placement/layout hints deeper into board rendering and later generalize custom zones once the migration path is clear.


## Module-driven board layout

Game modules can now provide normalized board positions for owner-scoped zones using per-seat coordinates in the shared 1000×600 tabletop space. The local renderer consumes these positions for deck and discard placement instead of relying on fixed CSS classes.

Modules may also define non-interactive custom zone markers with a default normalized position. These markers are presentation/layout hints only at this stage; they do not yet create new serialized card-zone kinds.

This keeps the current saved-table schema stable while moving visual board layout into module data. A later state-schema migration can promote selected custom zones into fully interactive destinations once compatibility rules are defined.


## Interactive module zones and table state v4

Table state version 4 allows cards to store validated module zone IDs instead of only the four original core zone names. Existing version 3 table files remain importable through an explicit migration path.

The tabletop action reducer accepts an active module's allowed-zone and stackable-zone policy. Moves into undeclared zones are rejected, and stacking is only permitted in zones declared stackable by the module.

Per-view projections also accept the active module's public-zone list so custom zones can participate in multiplayer hidden-information filtering without becoming universally visible by default.

The development server currently uses the generic built-in module policy until room-level module selection is added in the multiplayer module PR.


## Game-neutral cards and decks

Card definitions are module-bound catalog records containing a stable card ID, module ID/version, display name and module-defined metadata. Deck files use a separate versioned schema containing the module ID/version and a list of card definition IDs.

Deck validation requires every referenced card to exist in the selected module's catalog. Cross-module decks and unknown card IDs are rejected. Card search indexes names, stable IDs and metadata values without depending on a specific game's fields.

When a validated deck is loaded into the local tabletop, physical card instances receive unique tabletop IDs plus a safe `definitionId` link back to the catalog. Hidden multiplayer projections redact both the card name and definition ID.


## Multiplayer module selection

Room settings now pin an exact game module ID and version. The server validates that the selected module supports the room's match format before room creation or settings changes.

The selected module is persisted with the room snapshot and restored after reconnect or server restart. Match creation uses that module's built-in starter deck, and authoritative action validation/projection uses that module's allowed, stackable and public zones.

Clients render module identity, labels, card-back patterns and custom zones from the server-provided room settings. The client cannot choose a different module after the match starts because room settings are locked with the rest of the lobby configuration.
