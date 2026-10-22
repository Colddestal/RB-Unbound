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
