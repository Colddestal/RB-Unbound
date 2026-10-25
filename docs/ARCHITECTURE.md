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


## Module-aware card inspector metadata

Visible physical cards may carry a catalog `definitionId`. When the active module declares card metadata fields, the shared inspector resolves that definition against the active module/version and renders only those declared fields, in module order.

Because hidden multiplayer projections redact both card names and definition IDs, the inspector cannot resolve metadata for unauthorized hidden cards. Different modules can expose different schemas without branching the inspector UI.


## Declarative module packages and compatibility

A distributable RB Unbound module package uses package schema version 1 and contains:
- one validated game-module definition
- the card catalog for that exact module ID/version

Packages remain declarative JSON. The package validator reuses the module and card validators, rejects duplicate card IDs, caps catalog size, and rejects unknown package schema versions.

### Client installation

The PC client can import module packages up to 200 KB into its local module library. Built-in module ID/version pairs cannot be replaced by imported content. Multiple versions of a custom module may coexist because selection keys use `moduleId@version`.

Local table save files now pin the exact module ID/version. Current saves refuse to open if that exact package is unavailable and explain which module/version is required. Legacy raw v3/v4 tabletop files remain importable for compatibility.

### Multiplayer distribution

The host sends the selected validated package when creating a room or changing the module in the lobby. The server independently validates the package, protects built-in versions from replacement, and stores accepted custom packages in the durable server snapshot.

Room snapshots include the authoritative package. Joiners therefore render the room from the server-provided module/catalog even if they never installed that package locally. Reconnect and server restart keep the same module package available.

Custom module uploads are bounded by Socket.IO and per-event payload limits and remain subject to the existing room-creation/settings rate limits.

### Trust boundary

Module packages contain data only. Installing or joining a room with a package does not grant code execution, filesystem access, network access, dynamic imports, DOM access or automatic rules execution.


## Mirrored player perspective and mat geometry

The 1v1 renderer now presents the local player at the bottom of the tabletop. Seat 2 receives a 180-degree board-coordinate transform for presentation and pointer input, while individual visible cards remain upright except for their explicit 90-degree tapped state.

Game modules may define optional normalized zone sizes in addition to positions. The renderer uses these dimensions to draw mat-style areas behind cards. Owner-scoped areas can provide separate seat positions, allowing the opponent's half of a mat to be a mirrored arrangement while shared areas such as a battlefield remain centered.

The original Frontier Skirmish module demonstrates a wide tabletop with a dominant shared Battlefield plus mirrored Base, Resources, Commander, Vanguard, Deck, Resource Deck and Discard areas. This is an original structural test layout and does not include third-party branding, artwork or a licensed Riftbound module. An authorized game-specific module can map the same generic geometry system to its own exact zones later.


## Left tabletop context dock and match history

The live tabletop uses one persistent left-side context dock with three tabs:

- **Card Info** — the existing privacy-aware card inspector and module metadata.
- **Chat** — room text chat during multiplayer matches. Local sandbox explains that chat is multiplayer-only.
- **History** — a bounded chronological activity feed for meaningful tabletop actions.

Multiplayer history is server-authoritative and persisted with the room snapshot. It records match start, draw, shuffle, tap/untap, flip, zone movement, stack and unstack actions. Continuous pointer movement is intentionally excluded so dragging a card does not flood the activity feed.

History follows the same hidden-information boundary as the tabletop. Card names are only written to shared history when the card is face-up in a module zone marked public. Draws and other private actions use generic wording such as "drew a card" rather than revealing card identity.

The local sandbox keeps a client-side activity log for manual testing of the same dock experience.


## Generic locations, slots, piles and match series

The module schema can now describe tabletop structure without hard-coding a particular game's terminology.

Zones may optionally declare a generic behavior:

- `pile` — an ordered pile of cards
- `hand` — a private hand-like collection
- `slot` — a fixed-capacity placement slot; slot capacity is 1
- `area` — a free placement area
- `location` — a rules-significant place that cards can occupy
- `subzone` — a nested child of another zone

A module may also attach its own stable semantic `role` string. Roles are deliberately opaque to the core engine, so an authorized game module can use names such as a leader slot, objective, resource pile, or battlefield without adding those concepts to shared engine code.

Zones support optional parent-child nesting and capacity hints. A subzone must reference another declared zone, and cyclic or missing parent relationships are rejected by validation. This is intended to support structures such as a private facedown sub-zone associated with a public location.

### Declarative pile capabilities

Being a pile does not automatically grant deck actions. A module can explicitly declare:

- the zone that a draw from that pile moves a card into
- whether that pile may be shuffled through the normal player pile action

The multiplayer server derives these capabilities from the authoritative module package. Clients may request which pile to draw from or shuffle, but they cannot choose an arbitrary draw destination. Existing schema-v1 `deck` zones retain their historical deck-to-hand/shuffle behavior for backward compatibility.

The tabletop reducer also supports internal/manual actions that draw from one declared zone into another. This provides the generic primitive needed for modules with more than one ordered draw pile while preserving the existing single-deck experience.

### Bo1 / Bo3 series state

Rooms now have a generic `bestOf` setting of 1 or 3. Starting a room initializes a durable series record containing:

- current game number
- wins required
- wins by team
- per-game status
- optional first-player seat
- opaque per-seat setup selections
- per-game winner

Setup-selection IDs are deliberately module-defined. The core does not know whether a selection represents a battlefield, map, objective, scenario, or another game-specific choice. Completed game records remain in the series so a rules module can later evaluate used/remaining selections across a multi-game match.

The generic series helpers support setup -> active -> complete transitions and advance a best-of-three match until one team reaches two game wins. The development server exposes and persists this series data through normal room snapshots. Older persisted rooms restore as Bo1.


## Wide mirrored location mat

The tabletop coordinate system is 1000×600, so the PC renderer now uses the matching 5:3 aspect ratio instead of squeezing those coordinates into 16:9. This preserves the intended vertical spacing between player bands and reduces pile/slot overlap.

The original Frontier Skirmish proof module demonstrates the location-oriented mat structure using original/generic terminology:

- dedicated Leader and Champion single-card slots
- independent Main Deck and Resource Deck piles
- Trash pile
- player Base
- separate Resources row
- top/bottom Hand bands
- two shared Battlefield objective slots
- a large central Combat Area surrounding those objectives
- private facedown subzones attached to each objective in module data

Seat 2 uses the existing 180-degree viewer transform, so either 1v1 player sees their own side at the bottom while card faces themselves remain upright except for explicit 90-degree tap rotation.

The left Card Info / Chat / History dock remains outside the board coordinate space. On normal PC widths the app reserves 270px for that dock and a minimum wide tabletop column, rather than overlaying the dock on game zones.

This proof layout intentionally uses original module labels and assets. Game-specific names/artwork remain separate from the generic engine and authorization boundary.


## Shared-card visual mirrors and card context actions

A module zone may optionally declare `displayCopies`: additional board coordinates used to render one underlying shared-zone card in more than one place. This is a presentation-only feature. The tabletop state still contains one card ID in one zone, so selecting, inspecting, moving, flipping or otherwise acting on any rendered copy affects the same authoritative card.

The Frontier Skirmish proof module uses this for its two shared objective slots. Each chosen objective can be shown once toward each player half while the smaller center slot remains the shared logical location. Viewer perspective transforms apply to every copy, so the presentation remains mirrored in 1v1.

Visible cards also support a PC right-click context menu. The menu always permits inspection, while mutation actions are shown only for cards the current player controls. Common actions include tap/untap, flip, return to Hand, move to Trash/Discard, move to the Main Deck, unstack, and move to other non-subzone module destinations. Multiplayer still sends every mutation through the normal authoritative action path; right-click is only another input surface and does not bypass server permissions.

Tabletop card dimensions are responsive and smaller than the initial prototype. Drag placement and selection geometry now derive from the rendered card size instead of assuming a fixed 86×117 card.


## Resizable non-overlapping tabletop dock

The left Card Info / Chat / History surface and the tabletop board now occupy separate grid columns. The dock is never layered over the board on normal PC layouts.

The dock column is horizontally resizable from 190px to 420px using the divider on its right edge. The selected width is stored in localStorage and reused by Local Sandbox and Multiplayer. Dragging right makes the dock wider; dragging left gives more room back to the tabletop. Double-clicking the divider resets it to 270px.

The divider is keyboard accessible:
- Left / Right arrows resize in small steps
- Home selects the minimum width
- End selects the maximum width

Below the narrow-screen fallback breakpoint the layout stacks and the resize handle is hidden. No module coordinates or tabletop zone geometry are changed by this feature.


## Default full mat and seeded secondary piles

The product default is the built-in Full Mat Prototype rather than Generic Duel. Local Sandbox, new multiplayer rooms and the development server all resolve the same centralized `defaultGameModule`.

The default mat exposes the expected structural zones:
- Legend
- Champion
- Main Deck
- Rune Deck
- Base
- Runes
- Hand
- Trash
- Battlefield A / Battlefield B
- central Combat Area

Module pile definitions may optionally seed placeholder cards for development/testing using `initialCount` and `initialLabel`. The Full Mat Prototype seeds 12 hidden Rune cards per player into the Rune Deck.

Hidden secondary piles can expose count-only summaries with `countPublic`. Multiplayer clients receive only the count for those piles, not card identities or ordering. Drawing from the Rune Deck is server-authoritative and moves the top placeholder Rune face-up into the public Runes row.

No official card art or proprietary card data is bundled by this prototype.


## Format-aware seats, spectator capacity, and movable mat zones

Player seats and spectators are separate concepts.

- 1v1 requires Seats 1–2.
- 2v2 and FFA4 require Seats 1–4.
- Spectators never occupy player seats and never participate in readiness or start requirements.
- The host controls spectator capacity from 0 to 4. Empty spectator slots are optional and never block match start.
- The server rejects spectator joins when the configured capacity is full and prevents lowering the cap below current spectator occupancy.

Tabletop zones can also declare a logical `group`. This lets visually distinct areas participate in the same broader play space without collapsing their labels or geometry into one zone.

The Full Mat Prototype uses:
- Combat Area: `group: battlefield`
- Base: `group: battlefield`
- Runes: `group: runes`

Base and Runes are movable card zones. Cards in those zones use the same authoritative `move` action, pointer dragging, box selection, keyboard nudging, tap/flip controls and right-click actions as ordinary field cards. A card in Base remains visually in Base while being semantically part of the broader battlefield interaction group. Cross-zone stacking is permitted only when both zones are movable and share the same logical group.


## Horizontal zone card layout

Module zones may declare `cardLayout: "horizontal"` for untouched cards that should automatically fan across the zone rather than stack diagonally.

The Full Mat Prototype uses this for the Runes row. Newly drawn Runes:
- stay on one horizontal line
- spread evenly across the available Rune-zone width
- appear grouped by their color while retaining draw order within each color
- compress spacing as the row fills so all 12 starter Runes remain on the mat
- remain individually selectable
- keep automatic positions only until the player manually moves that card

The authoritative table state still stores untouched drawn Runes at their neutral coordinates. Local and Multiplayer derive the same deterministic presentation position from zone geometry, color, card order and current zone count. Once a Rune is manually dragged, its explicit x/y coordinates override the automatic row layout. Color borders reinforce each group.


## Spatial battlefield placement

Movable battlefield cards now reconcile their logical zone with the visual layer where they are released.

The client performs canonical board-space hit testing against module zone rectangles. For cards in the `battlefield` logical group:
- releasing inside the owning player's Base changes the card zone to `base`
- releasing inside the shared Combat Area changes the card zone to `field`
- releasing outside a compatible battlefield layer leaves the current logical zone unchanged
- unrelated groups such as Runes are excluded from battlefield layer selection

Hand-to-board dragging uses the same hit test, so dropping directly onto Base no longer requires the right-click Move to Base action.

Zone transitions carry the exact release coordinates in the same action that changes the logical zone. Cards are centered at that position on both Combat Area and Base, with no jump to a zone's predefined location. A card played from Hand into any `battlefield` group destination receives the same face-down play treatment as a card played to the normal field. The board's zone outlines remain visible without printed labels; card inspection and accessible card names remain available.

Spatial layer selection is presentation-driven input only; Multiplayer sends a server-authoritative `to-zone` action with optional coordinates for drops that change zones, and `move` for drops within a zone. The server validates ownership and allowed zones.


## Spatial battlefield layer snapping

Visual placement and logical battlefield zones are now linked during drag-and-drop.

Movable zones that share a logical `group` can act as spatial layers. For the Full Mat Prototype, Base and Combat Area both belong to `group: battlefield`.

When a battlefield card is released:
- dropping inside the owning player's Base changes the card's logical zone to `base`
- dropping inside the shared Combat Area changes it to `field`
- dragging a Base card out of Base falls back to `field`
- Runes are not affected because they belong to the separate `runes` group

Spatial resolution is geometry-driven from the module's declared zone centers and sizes. When overlapping layers match, the smaller layer wins, so Base takes priority over a larger Combat Area if their geometry overlaps.

Changing between Base and Combat Area preserves the exact card coordinates from the drag. Right-click zone actions remain available, but normal play no longer requires them for Base placement.

While a battlefield card is being dragged, battlefield spatial layers receive a subtle visual highlight to communicate valid snap regions.
