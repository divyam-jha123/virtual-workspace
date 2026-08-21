# Dockerized Map-Design MCP — Implementation Plan (rev 2)

> **SUPERSEDED (rev 3, 2026-08): the asset-API architecture below was dropped.**
> The external asset-library API, `HttpAssetRepository` / `CompositeAssetRepository`,
> `AssetApiDto`, the browser "selection" handshake, `sync_tilesets`, `pick_asset`,
> the `lockfile.json` / `TilesetCache`, and the separate Asset Manager app were all
> **removed** in favour of a much smaller design: **the filesystem is the source of
> truth for art.** The MCP scans `content/assets/*.json` and `content/tilesets/*.tsj`
> directly — no database, no asset service, no network. Wherever this document
> mentions an asset API, `ASSET_API_URL`/`ASSET_APIS`, HTTP repositories, remote
> vendoring or tileset sync, treat it as **historical**. The current architecture
> and tool list live in [`../README.md`](../README.md) and
> [`../tools/map-mcp/README.md`](../tools/map-mcp/README.md).

Status: **B1–B6 implemented** in `tools/map-mcp` (see its README). Branch: `feature/map-design-mcp`.
The rest of this document is unchanged and still describes the full programme; only the
"Rev 3 — Scope of this branch" subset has shipped.

**Rev 2 decisions (from the product owner):**
1. PixiJS is being **completely replaced by Phaser**.
2. An **external asset-library API** exists and serves **Tiled-ready `.tsj` + atlas images**; auth is an **API key from env**, reached over the **public internet**.
3. Sequencing: **MCP first, Phaser after.**

These simplify the previous revision considerably — and they kill the hardest open question in rev 1 (procedural art vs. a real asset library). Real tilesets win by default, because the code that draws art procedurally dies with Pixi.

---

## Rev 3 — SCOPE OF THIS BRANCH (`feature/map-design-mcp`)

**In scope: the MCP server and its Docker packaging. Nothing else.**

Not touched on this branch — no edits at all to `apps/frontend/src/game/**`:
`officeLayouts.ts`, `props.ts`, `tileset.ts`, `themes.ts`, `schema.ts`, `collision.ts`,
`Zones.ts`, `Seats.ts`, `PixiWorld.ts`. No map porting, no Phaser work, no
`packages/map-runtime`, no `export_runtime_map`, no deletion of Pixi code. The game keeps
running exactly as it does today; this branch adds a tool beside it and changes nothing it
depends on.

**Two consequences worth naming:**

1. **`packages/map-schema` is deferred.** Rev 2 had it as P1 because it required refactoring
   the frontend's map files into a shared package — which is precisely what this branch must
   not do. Instead the schema (layer names, object classes, property rules, tile size) lives
   at `tools/map-mcp/src/schema/` as a **standalone definition**, written fresh, importing
   nothing from the frontend. It gets extracted into `packages/map-schema` when the Phaser
   work needs to share it. Zero rework: the same files move, the imports change.

2. **No asset vendoring, no tileset cache, no lockfile.** Those write into `content/tilesets/`
   and shape how maps reference art — real decisions to make once art actually exists. This
   branch ships only the **seam**, per your ask.

### The asset seam this branch delivers

```text
AssetService
    |
    +-- AssetRepository            <- the interface everything above codes against
          |
          |-- LocalAssetRepository   reads content/assets/  (the local folder, works today)
          `-- HttpAssetRepository    ASSET_API_URL + ASSET_API_KEY  (the connection point)
```

- `content/assets/` is created (with a README and `.gitkeep`) and mounted into the container.
  Drop files in and `LocalAssetRepository` finds them. It is the default source, so the MCP
  is fully usable with no API credentials.
- `HttpAssetRepository` is wired to real config — `ASSET_API_URL`, `ASSET_API_KEY`,
  `ASSET_SOURCE=local|api`, documented in `.env.example` — with the request/response mapping
  isolated in one `AssetApiDto` module. Until you hand over the real endpoint shapes, it is
  written against the assumed contract and covered by mocked tests; pointing it at the live
  API is a one-file change plus setting two env vars.
- Both implementations pass one shared `AssetRepository` contract suite, so swapping the
  source never changes behaviour above the interface.

### Branch phases

**B1 — Package skeleton.** `tools/map-mcp` (ESM, NodeNext, strict, matching `packages/*`
conventions), `- "tools/*"` in `pnpm-workspace.yaml`, vitest, `@modelcontextprotocol/sdk`,
`dev`/`build`/`test`/`lint` scripts so Turbo picks it up.
*Accept:* `pnpm build` and `pnpm test` pass repo-wide; no existing package is modified beyond
the workspace glob.

**B2 — WorkspaceService + path jail.** Tests first: absolute paths, `..`, symlink escape,
extension allowlist, writes confined to `maps/ tilesets/ assets/ runtime/ .map-mcp/`.
Scaffold `content/` with `maps/ assets/ tilesets/ schemas/ .map-mcp/` + READMEs.
*Accept:* every traversal attempt rejected by a test.

**B3 — MCP server over stdio.** `index.ts` transport wiring (isolated so HTTP is a later
one-file addition), `server.ts` registration, `get_project_info`, `project://config`,
`project://conventions`, uniform error envelope with `fix` hints.
*Accept:* the server appears in Claude Code and answers `get_project_info`.

**B4 — Asset seam.** `AssetRepository` interface, `AssetRecord`, `LocalAssetRepository`,
`HttpAssetRepository` + `AssetApiDto` (retry/backoff, ETag, 401 handling, host-pinned egress,
key redaction in every error path), `AssetService` ranking, `search_assets`, `get_asset`,
`list_tilesets`. Shared contract suite + mocked-HTTP suite.
*Accept:* `search_assets` works against `content/assets/` with no network; flipping
`ASSET_SOURCE=api` routes the same calls through HTTP against a mock.

**B5 — Map engine.** Standalone schema module; `TiledAdapter` parse/serialize `.tmj`/`.tsj`
(stable key order, atomic tmp+rename); `MapModel`; `read_map`, `create_map`, `add_layer`,
`place_tiles`, `place_asset`, `add_object`, `move_object`, `remove_object`, `set_property`,
`add_tileset`, `save_map`; validator with the §K rules that don't depend on vendoring;
`validate_map`. Fixture authored by hand in Tiled as ground truth.
*Accept:* a Claude-generated `.tmj` opens cleanly in Tiled; parse→serialize→parse round-trips.

**B6 — Docker.** Multi-stage `node:20-alpine`, non-root, prod deps only, `.dockerignore`
excluding `content/`, `apps/`, `.git`, `.env*`; `infra/docker/docker-compose.map-mcp.yml`;
single `content/:/workspace` mount; env passed at run time, key never baked or logged;
documented Claude Code `mcpServers` config; stdio smoke test.
*Accept:* the full tool set works from the container with only `content/` mounted.

**Optional if the branch has room:** `set_map_state` + `DiffService` + `get_map_diff`
(§L) and the `open_in_tiled` host bridge (§G.5) — both self-contained and touch no game code.

Everything in §O beyond this — tileset vendoring, map porting, Phaser, deleting Pixi code —
is a **later branch**. The sections below describe that full target; read them as the
destination, and this section as what ships here.

---

## A. Current-state analysis

### A.1 Repo facts

pnpm 10 workspaces + Turborepo (`apps/*`, `packages/*`, `scripts`), Node >= 20. `apps/backend` (NestJS 10 + Prisma + Postgres, 6 Jest specs), `apps/frontend` (Vite + **PixiJS 8** + React 19 overlay, **zero tests**), `apps/web` (Next 14 lobby). Packages are ESM, `NodeNext`, `strict`, built with `tsc`, consumed as `workspace:*`. Docker exists for **Postgres only** — no app Dockerfile. `.github/workflows/` is empty: **there is no CI**. Env is a flat root `.env` read via `@nestjs/config` / `VITE_*`. Commits are one-liners, no trailer.

### A.2 The map system today, and what survives the Phaser swap

`apps/frontend/src/game/` is 4,705 lines, of which **2,502 are Pixi-coupled** across 10 files.

| File | Lines | Fate under Phaser + real tilesets |
|---|---|---|
| `map/officeLayouts.ts` | 851 | **Content source.** Four hand-authored ASCII floor plans — the only record of the level design. Port the *structure* to `.tmj`; the art becomes real tiles. |
| `map/props.ts` | 655 | **Delete.** ~35 procedurally-drawn props. Replaced by catalog assets. Salvage `PROP_SIZE_PX` / `PROP_COLLISION_BOX` as collision metadata only. |
| `map/tileset.ts` | 144 | **Delete.** Canvas-drawn tiles; replaced by atlas images. Keep `TILE_SIZE = 32` as a project constant. |
| `map/themes.ts` | 82 | **Delete.** Palette-based theming is meaningless once art is baked into PNGs — "theme" becomes "which tileset". |
| `map/schema.ts` | 184 | **Retire** with the ASCII format. `OfficeMapData` stops being the contract; `.tmj` becomes it. |
| `map/collision.ts` | 147 | **Port the math.** Coverage-based footprint blocking (`COLLISION_COVERAGE = 0.5`) is genuinely tuned logic; it becomes a validation/authoring rule, with Arcade Physics doing runtime collision. |
| `entities/Zones.ts`, `entities/Seats.ts` | 474 | **Invert.** Both *auto-generate* zones and seats by clustering furniture. Under Tiled these become **authored object layers**; the generators survive at most as one-time migration helpers to seed the `.tmj` files. |
| `world/PixiWorld.ts`, `world/Camera.ts`, `world/Minimap.ts` | ~750 | **Rewrite in Phaser** (Scene, Cameras, tilemap layers). |
| `entities/Player.ts`, `RemotePlayer.ts`, `NameTag.ts`, `characters.ts` | ~700 | **Rewrite in Phaser** (Sprites, Arcade body, Text). Movement *behaviour* (eased physics, remote lerp) ports; the rendering does not. |

**Conclusion:** the only durable artifacts from today's map code are (a) the four floor-plan designs, (b) the collision-footprint math, and (c) the seat/zone semantics. Everything else is scaffolding that the Phaser migration removes anyway — which is exactly why the MCP should target Tiled + real tilesets directly and **never** grow a compatibility layer for Pixi.

### A.3 The consequence for sequencing

You chose **MCP first, Phaser after**. One honest caveat, and a way around it:

A `.tmj` built from real API tilesets **cannot be rendered by the current Pixi client at all** — Pixi draws code-generated art and has no image-tilemap renderer. Making it visible in-game before Phaser lands would mean writing a Pixi tilemap renderer that gets deleted weeks later.

**Do not build that.** Instead: build MCP phases 1–8 (all renderer-agnostic — schema, asset API client, TMJ read/write, validation, review, diff) and use **Tiled itself as the visual verification surface**. Tiled renders the map exactly as authored, with the real atlases; it is a better review tool than a half-finished renderer. The in-game loop closes when Phaser lands, and the runtime loader is then thin (N) because Phaser reads Tiled JSON natively. That honours "MCP first" without buying anything disposable.

---

## B. Target architecture

```text
Claude Code --stdio--> Docker: map-mcp
                        |-- tools/            MCP tool handlers (zod-validated, thin)
                        |-- MapService        semantic ops on an in-memory MapModel
                        |-- AssetService      search / resolve / rank
                        |     `-- AssetRepository  -- HTTP -->  External Asset API
                        |           `-- TilesetCache            (.tsj + atlas PNGs, API key)
                        |-- TiledAdapter      MapModel <-> .tmj / .tsj
                        |-- RuntimeExporter   .tmj -> Phaser-loadable bundle
                        |-- Validator         schema + conventions + runtime compat
                        |-- DiffService       semantic diff of two map snapshots
                        `-- WorkspaceService  path jail, atomic writes, DRAFT->...->COMMITTED
                                 |  (single bind mount, read-write under /workspace only)
                                 v
                       Host: virtual-workspace/content/
                       |-- maps/*.tmj             canonical, committed
                       |-- tilesets/*.tsj + png   VENDORED copies pulled from the API
                       |-- schemas/*.json         shared contract
                       |-- runtime/*.json         exported Phaser bundles
                       `-- .map-mcp/              drafts, snapshots, status.json, http cache
                                 |
                        +--------+--------+
                        v                 v
                  Tiled (host GUI)   packages/map-runtime -> apps/frontend (Phaser)
                  human edits            thin loaders over Phaser's native Tiled support
```

### B.1 The asset-API integration, concretely

This is the part that changed most, so it gets spelled out.

**Principle: the API is a _source_, the workspace holds _vendored copies_.** The MCP never leaves a map depending on a live network call. Three hard reasons:

1. **Tiled runs on the host with no API key.** It resolves `"source": "../tilesets/office.tsj"` as a plain relative path. If the tileset isn't a real local file, the human opens a broken map.
2. **Git must be able to reproduce a map.** A `.tmj` committed today has to render identically in six months, whatever the API has done to that asset since.
3. **The runtime must not depend on the asset API.** Phaser loads images from your own static hosting, not from a third-party API with a secret in the URL.

**Flow for `place_asset`:**

```text
place_asset(assetId="office.desk.pod4")
   |
   |- AssetService.get(id) --> HttpAssetRepository --> GET /assets/{id}   [API key header]
   |                              `- ETag/TTL cache in .map-mcp/http-cache/
   |
   |- asset belongs to tileset "office-core@3"
   |     |- already vendored at content/tilesets/office-core.tsj at version 3? -> use it
   |     `- else TilesetCache.ensure():
   |            GET /tilesets/office-core@3.tsj   -> validate JSON, rewrite image paths
   |            GET <atlas image url>             -> validate content-type + size + decode
   |            write atomically into content/tilesets/, record version + sha256
   |            in content/tilesets/lockfile.json
   |
   |- TiledAdapter binds it into the map as an EXTERNAL tileset (firstgid assigned)
   `- MapService places the tile/object; validator re-runs
```

**`content/tilesets/lockfile.json`** — the asset equivalent of `pnpm-lock.yaml`: for every vendored tileset, its API id, version, resolved image files, and sha256 of each. Gives you reproducible builds, drift detection (`sync_tilesets --check`), and an explicit, reviewable upgrade step. Without it, "the atlas changed upstream" silently breaks committed maps.

**Offline / degraded mode.** If the API is unreachable and every tileset the map needs is already vendored, all map operations still work; only `search_assets` and new-tileset pulls fail, with a clear "asset API unreachable, N tilesets available offline" message. This falls out for free from vendoring and is worth stating as a requirement — it keeps a network blip from bricking a design session.

**Responsibilities**

- **`HttpAssetRepository`** — the only code that knows the API's URL shape, headers, and error codes. Retries with backoff on 5xx/429, honours ETag, surfaces auth failure as one clear diagnostic.
- **`TilesetCache`** — download, verify, vendor, lock. The only component allowed to write into `content/tilesets/`.
- **`AssetService`** — ranking, synonym expansion, style filtering, "does this fit the map's tile size" checks. Transport-agnostic.
- Everything else is as in rev 1: MapService owns the model, TiledAdapter owns the JSON, Validator and DiffService are pure functions, WorkspaceService is the sole filesystem gate.

---

## C. Proposed folder structure

```text
tools/map-mcp/                     # MCP server (Node ESM, NodeNext - matches packages/*)
  src/index.ts                     # stdio entry
  src/server.ts                    # tool + resource registration
  src/tools/                       # one file per tool, zod schema alongside
  src/services/                    # map, asset, http-asset-repo, tileset-cache,
                                   # tiled, runtime-export, validator, diff, workspace
  src/model/                       # MapModel (internal; not the wire format)
  test/  fixtures/                 # vitest + real Tiled-authored fixtures
  Dockerfile  .dockerignore

packages/map-schema/               # THE shared contract, zero runtime deps
  src/                             # layer names, object classes, property schemas,
                                   # tile size, collision metadata types
  schemas/*.json                   # generated JSON Schema (also copied to content/schemas)

packages/map-runtime/              # thin Phaser loaders (built in the Phaser phase)
  src/{map-loader,object-loader,collision-loader,spawn-loader,interaction-loader}.ts

content/                           # the ONLY thing mounted into the container
  maps/  tilesets/ (+ lockfile.json)  schemas/  runtime/  .map-mcp/

scripts/tiled-bridge.mjs           # host-side watcher for open_in_tiled
infra/docker/docker-compose.map-mcp.yml
```

Add `- "tools/*"` to `pnpm-workspace.yaml`. `content/` sits at the repo root, not under `apps/frontend`, so the mount never exposes source code or `.env`; the frontend consumes `content/runtime/` as static assets.

---

## D. MCP tools

Conventions unchanged: JSON in/out; paths are **workspace-relative ids**, never absolute; writes return post-write diagnostics; uniform error envelope with a `fix` hint so Claude can self-correct.

### V1

| Tool | Purpose | Notes vs rev 1 |
|---|---|---|
| `get_project_info` | conventions, tile size, layer names, object classes, map index, **asset-API status** | now reports API reachability + vendored tileset count |
| `search_assets` | semantic search over the remote catalog | **hits the API** (cached); filters by tile size + style |
| `get_asset` | full asset record | remote |
| `list_tilesets` | vendored tilesets + versions from the lockfile | now lockfile-driven |
| `sync_tilesets` | **new** — pull/update/verify vendored tilesets; `--check` reports drift without writing | the explicit, reviewable upgrade step |
| `read_map` | semantic view of a map | unchanged |
| `create_map` | new map from the project template | unchanged |
| `save_map` | flush draft to `.tmj`; blocks on `error` diagnostics | unchanged |
| `add_layer` / `place_tiles` / `place_asset` / `add_object` / `move_object` / `remove_object` / `set_property` | semantic mutations | `place_asset` now triggers the vendor flow (B.1) |
| `add_tileset` | bind a vendored `.tsj` as external, assign firstgid | now vendors first if missing |
| `validate_map` | run all rules (K) | adds tileset-lock + atlas-exists rules |
| `export_runtime_map` | **promoted to V1** — emit the Phaser-loadable bundle into `content/runtime/` | see N.2: Phaser does not resolve external tilesets, so this is required, not optional |
| `get_map_diff` | semantic diff (L) | unchanged |
| `set_map_state` | DRAFT->REVIEW->APPROVED transitions | unchanged |

### Later

`open_in_tiled` (needs the host bridge, G.5) - `commit_map` (M — prefer host-side Git in V1) - `generate_asset` (AI generation, quarantined) - `automap_apply` (needs headless Tiled).

**Error envelope**
```json
{ "ok": false, "code": "ASSET_API_UNAVAILABLE",
  "diagnostics": [{ "severity": "error", "rule": "asset-api-unreachable",
    "message": "Asset API returned 401 (check ASSET_API_KEY)",
    "fix": "3 tilesets are vendored locally; place_asset works for assets in office-core@3" }] }
```

---

## E. MCP resources

Implement: `project://config`, `project://conventions`, `map://schema`, `runtime://map-contract` (the Tiled->Phaser contract, N), and `assets://tilesets` (the lockfile — small, stable, read often).

Skip: `assets://catalog` — the catalog is remote and potentially large; `search_assets` is the right access path. Skip `map://current` — ambiguous with multiple maps and mutable drafts.

---

## F. Asset architecture

**The API is the catalog. There is no local asset library** — only the vendored tileset cache. This deletes an entire subsystem from rev 1 (`assets/manifests/`, `previews/`, the `legacyPropType` bridge).

```ts
interface AssetRepository {
  get(id: string): Promise<AssetRecord | null>;
  search(q: AssetQuery): Promise<AssetRecord[]>;
  listTilesets(): Promise<TilesetRef[]>;
  fetchTileset(id: string, version?: string): Promise<{ tsj: TilesetJson; images: ImageBlob[] }>;
}
```

Implementations: **`HttpAssetRepository`** (production) and **`FixtureAssetRepository`** (tests + offline dev — reads the same shapes from `tools/map-mcp/fixtures/`). Both pass one shared contract test suite.

`AssetRecord` as in rev 1 (id, name, category, subcategory, tags, style, tileSize, dimensions, placement, tileset+tileId, collision, interaction, source/license, version) **minus** `legacyPropType` and `image` — with real tilesets every asset resolves through `{ tilesetId, tileId }`.

**Two integration rules that keep the seam clean:** nothing above `AssetRepository` handles a URL, a header, or a filesystem path; and `AssetRecord` is the only asset shape that crosses the interface.

**Adapting to the real API.** Since the API isn't wired yet, isolate its exact request/response shape in one `AssetApiDto` module with explicit mapping functions into `AssetRecord`. When the real endpoints differ from the assumed ones, you change one file, not the service layer. Write that mapping against a captured real response as soon as you have credentials — before building anything on top of it.

---

## G. Tiled integration

1. **`.tmj`** — read and write directly as JSON. Stable key order, `infinite: false`, plain int arrays. Round-trip test: a Tiled-saved file must survive parse->serialize unchanged modulo formatting.
2. **`.tsj`** — **fetched from the API, never hand-written.** Parse for tile ids, sizes, per-tile properties, and collision shapes. The MCP only writes them via `TilesetCache`.
3. **Tile layers** — dense `data: number[]`, gid = firstgid + tileId, horizontal-flip flag supported.
4. **Object layers** — `class` + typed custom properties; spawns, doors, zones, seats live here.
5. **Custom properties** — legality per class enforced by `map-schema`.
6. **External tilesets** — always external in the authoring `.tmj` (small diffs, reusable); **embedded in the exported runtime bundle** (N.2).
7. **Collision** — union of per-tile collision from `.tsj` objectgroups and an explicit `Collision` layer; the ported footprint math from `collision.ts` becomes an authoring-time rule.
8. **Interaction objects** — authored rectangles with `class: interaction-zone | meeting-room | workstation`, replacing today's furniture-clustering derivation.
9. **Automapping / Tiled scripting** — **not V1.** Direct file I/O covers every operation and is CI-testable without a GUI. Revisit only for rule-driven work (wall-corner joining, floor variation), and then as a batch step with headless Tiled in a separate image stage.

**G.5 `open_in_tiled`.** The container must not touch the host GUI. The MCP writes `content/.map-mcp/open-request.json`; a host-side watcher (`scripts/tiled-bridge.mjs`) execs the local Tiled. The tool reports "requested", never blocks, and falls back to returning the path.

---

## H. Docker architecture

**Dockerfile** — multi-stage `node:20-alpine`: install pnpm -> copy lockfile + manifests -> `pnpm install --frozen-lockfile --filter map-mcp...` -> build -> runtime stage with prod deps only, non-root `node`, `ENTRYPOINT ["node","dist/index.js"]`. `.dockerignore` excludes `node_modules`, `dist`, `.git`, `content/`, `apps/`, `.env*`. No content in the image.

**Mount** — one parent: `../../content:/workspace:rw`.

**Env** — `MAP_MCP_WORKSPACE=/workspace`, `ASSET_API_URL`, `ASSET_API_KEY`, `MAP_MCP_LOG_LEVEL`, `MAP_MCP_MAX_MAP_TILES`, `MAP_MCP_OFFLINE=false`.

**Network — changed from rev 1.** `--network none` is no longer possible. Compensate:
- Outbound only; no ports published; the MCP never listens.
- The asset API host goes in `ASSET_API_URL` and the client **refuses any request to a different host** — including hosts named inside map or asset payloads (SSRF guard, I).
- The key is passed via `--env-file` or `-e` from the host env, **never baked into the image** and never logged (redact in all diagnostics).

**Claude Code config**
```json
{ "mcpServers": { "map-mcp": {
    "command": "docker",
    "args": ["run","--rm","-i",
             "-v","${PWD}/content:/workspace",
             "-e","MAP_MCP_WORKSPACE=/workspace",
             "-e","ASSET_API_URL","-e","ASSET_API_KEY",
             "vorkium/map-mcp:dev"] } } }
```
stdio over `docker run --rm -i`: no ports, no auth surface, process dies with the session.

**Dev loop** — run `pnpm --filter map-mcp dev` (tsx watch) natively against `./content`; use the container for integration/e2e and for handing the tool to another developer.

---

## I. Security

| Risk | Restriction |
|---|---|
| Path traversal | Every path goes through `WorkspaceService.resolve()`: reject absolute, `..`, and symlinks escaping the root (`realpath` check); allowlist extensions (`.tmj`, `.tsj`, `.json`, `.png`). No tool takes a raw path. |
| Container blast radius | Only `content/` mounted. Non-root. Read-only root FS + tmpfs `/tmp`. No published ports. |
| **API key handling** | Env only; never in the image, never in logs, never echoed in a tool result. Redact `Authorization`/key patterns in every error path. Document rotation. |
| **SSRF / egress** | Outbound requests are host-pinned to `ASSET_API_URL`. **Never fetch a URL that came from a map file, an asset payload, or a tool argument** — asset payloads are untrusted data. Block redirects to other hosts. |
| **Malicious downloads** | Verify content-type, cap size, decode-check images before writing, sanitize filenames (no path separators from remote data), write atomically, record sha256 in the lockfile. |
| Git | Stays **on the host** in V1. If ever moved in: `.git` read-only, `confirm: true` + APPROVED required, never push/force/branch-switch. |
| Command execution | No shell exec in the container. Tiled launching is a host-side file-watch bridge. |
| Generated volume | Cap map tiles, objects per map, snapshot count, vendored cache size. Writes confined to `maps/`, `tilesets/`, `runtime/`, `.map-mcp/`. |
| Untrusted content | Map/asset payloads are data. Custom property values are never interpreted as instructions or as paths to open. Surface anything injection-shaped instead of acting on it. |

---

## J. Map schema

Layer stack (bottom->top, order enforced): `Ground`, `Ground_Details`, `Walls`, `Furniture`, `Decorations`, `Collision`, `Objects`, `SpawnPoints`, `InteractionZones`, `AbovePlayer`.

Object classes and required properties:
- `workstation` — `capacity:int`, `seats?:string`
- `meeting-room` — `name:string`, `capacity:int`, `private:bool`
- `door` — `target?:string`, `locked:bool`
- `spawn` — `id:string`, `default:bool` (exactly one default per map)
- `npc` — `id:string`, `dialog?:string`
- `interaction-zone` — `kind:enum(audio-private,screen-share,trigger)`, `id:string`
- `seat` — `facing:enum(up,down,left,right)`, `seatType:enum(chair,sofa,stool,deskchair)`

`interaction-zone` is where proximity A/V (CLAUDE.md Phase 2) meets map data — the `audio-private` kind is the "private area" concept, and authoring it in Tiled beats today's furniture-clustering heuristic.

**Sharing:** `packages/map-schema` is the single source — TS types + generated JSON Schema. Consumed by the MCP (validation), copied to `content/schemas/` for a Tiled project file (so Tiled offers the right property types in its UI), and imported by `packages/map-runtime`. Same discipline as `packages/protocol` today.

---

## K. Validation

Pure predicates over `MapModel`, each with `id`, `severity`, `message`, `path`, `fix`:

- **Structure** — required layers present, right type, right order; dimensions in bounds; tile size matches project config.
- **Tilesets (updated)** — every gid resolves; every external `.tsj` reference exists **as a vendored file**; lockfile entry present and sha256 matches; every atlas image referenced by a `.tsj` exists on disk; no firstgid collisions; tileset tile size matches the map's.
- **Objects** — `class` in schema; required properties present and typed; ids unique; in bounds; unknown keys warn.
- **Gameplay** — exactly one default `spawn`; spawn tiles walkable; flood-fill reachability from the default spawn; no contradictory zone overlap.
- **Runtime compat (Phaser)** — no infinite maps, no image layers; tile layers are the encodings Phaser reads; every layer name the runtime loader expects is present; object properties Phaser needs are non-null.

`error` blocks `save_map` and APPROVED; `warning` surfaces; `info` advises. Returned as a diagnostics array plus a one-line summary Claude can relay verbatim.

---

## L. Map diff

Semantic, on the model, not the JSON text: `object.added|removed|moved|resized|property-changed`, `layer.added|removed|reordered`, `tiles.changed` (**summarized by region** — bounds + cells-changed + samples, never per-cell), `tileset.added|removed|version-changed`.

Identity by Tiled's stable numeric `id`, falling back to (class, position, name) with a small tolerance so a moved object reads as *moved*, not removed+added. Grouped by layer, capped (top 50 + "N more"), with a human summary line. This is what makes a human's Tiled session legible to Claude on the next turn.

---

## M. Git workflow

```text
AI draft (.map-mcp/drafts/hq.tmj, DRAFT)
 -> save_map + validate (errors block)
 -> set_map_state REVIEW (snapshot taken)
 -> open_in_tiled -> human edits content/maps/hq.tmj
 -> read_map + get_map_diff (snapshot vs current)
 -> human approves -> APPROVED
 -> export_runtime_map
 -> commit .tmj + tilesets + lockfile + runtime bundle  [human-run in V1]
```

Two explicit human gates: approving the reviewed diff, and the commit itself. The MCP never commits automatically, never pushes, never branches, never writes outside `content/`. `status.json` persists state, timestamps, and the approval note. In V1 prefer the human (or Claude Code on the host) running `git commit` and skip `commit_map` entirely — the MCP produces files; Git is not its job.

Vendored atlases are binary and get committed — keep them small, and consider Git LFS before the first large pack lands.

---

## N. Phaser integration

### N.1 Why this got much smaller

Phaser 3 loads Tiled JSON natively: `this.load.tilemapTiledJSON(key, url)`, `map.addTilesetImage()`, `map.createLayer()`, `map.getObjectLayer()`, plus `setCollisionByProperty` / `setCollisionByExclusion` for tile collision and Arcade Physics for bodies. So `packages/map-runtime` is **not a parser** — it is a thin, typed layer that maps *your project conventions* onto Phaser's API.

| Tiled | Phaser |
|---|---|
| `Ground`, `Ground_Details`, `Walls`, `AbovePlayer` tile layers | `map.createLayer(name, tilesets)`, depth-sorted; `AbovePlayer` above the player's depth |
| `Collision` layer + `.tsj` per-tile `collides` property | `layer.setCollisionByProperty({ collides: true })` + `physics.add.collider(player, layer)` |
| `Furniture` / `Decorations` objects | sprites from the atlas, `setOrigin(0.5, 1)` (bottom-center, matching today's anchoring), depth = y |
| `SpawnPoints` objects | `SpawnDef[]`; the `default:true` one seeds the player |
| `InteractionZones` objects | Arcade zones with overlap callbacks -> feeds proximity A/V |
| `seat` objects | `SeatDef[]` — same shape today's `Seats.ts` produces, now authored |
| Map custom properties | display name, description, tileset set |

Loaders, matching the split you proposed: `map-loader` (orchestrates), `object-loader`, `collision-loader`, `spawn-loader`, `interaction-loader`.

### N.2 The one real gotcha: external tilesets

**Phaser does not resolve `.tsj` `"source"` references.** An authoring `.tmj` full of external tilesets will not load. Hence `export_runtime_map` in V1: it reads the authoring `.tmj`, **inlines each external tileset**, rewrites image paths to the frontend's static asset URLs, strips authoring-only layers if any, and writes `content/runtime/<map>.json` next to the atlas images the client serves. Authoring stays diff-friendly; the runtime gets a single self-contained file. This is a build artifact — commit it or generate it in CI, but never hand-edit it.

### N.3 Scope of the Pixi->Phaser migration itself (separate project)

Not part of the MCP, but it's the dependency that closes the loop. Roughly: replace `PixiWorld`/`Camera`/`Minimap` with a Phaser `Scene` + `Cameras` + a minimap camera; re-implement `Player`/`RemotePlayer`/`NameTag`/`characters` as Phaser sprites (movement *behaviour* — eased physics, remote lerp — ports directly; rendering does not); delete `props.ts`, `tileset.ts`, `themes.ts`; keep the React overlay, `net/`, `state/`, and `packages/protocol` **completely untouched** — LiveKit wiring is renderer-agnostic and must not be disturbed by this swap. Budget it as its own effort against ~2,500 Pixi-coupled lines.

---

## O. Development phases

> **Scope note:** these are the *full-programme* phases. Only the B1–B6 subset in "Rev 3 — Scope of this branch" ships on `feature/map-design-mcp`; P4 (vendoring), P10 (map porting), P11 (Phaser) and P12 (deleting Pixi code) are explicitly out of scope here.

**P1 — `packages/map-schema`.** Layer names, object classes, property schemas, tile size, collision metadata types; generate JSON Schema. No `pixi.js` in its dep graph. *Accept:* imports cleanly in plain Node; the frontend still builds.

**P2 — MCP skeleton + path jail (+ minimal CI).** stdio server, `WorkspaceService`, `get_project_info`, `project://` resources. Add `.github/workflows/ci.yml` running `pnpm build && pnpm test` — this repo has none. *Tests first:* traversal, symlink escape, absolute paths, extension allowlist. *Accept:* tools visible in Claude Code; every traversal rejected.

**P3 — Asset API client.** **Do this early — it is the highest-unknown component.** `AssetRepository` interface, `HttpAssetRepository` + `AssetApiDto` mapping written against a **captured real response**, `FixtureAssetRepository`, retry/backoff/ETag caching, `search_assets`, `get_asset`. *Accept:* a real query against the live API returns usable `AssetRecord`s; the same contract suite passes against fixtures with no network.

**P4 — TilesetCache + vendoring.** Download, verify (content-type, size, decode, sha256), atomic vendor into `content/tilesets/`, `lockfile.json`, `sync_tilesets` (+ `--check`), `list_tilesets`. *Accept:* a pulled tileset opens in Tiled on the host with correct images; `--check` detects an upstream version bump.

**P5 — Tiled read path.** `parseTmj` / `parseTsj` -> `MapModel`; `read_map`. Ground-truth fixture authored by hand in Tiled. *Accept:* correct semantic view of a Tiled-authored map; malformed files produce clean diagnostics.

**P6 — Tiled write path + map manipulation.** `serializeTmj` (stable ordering, atomic tmp+rename); `create_map`, `add_layer`, `place_tiles`, `place_asset` (full vendor flow, B.1), `add_object`, `move_object`, `remove_object`, `set_property`, `add_tileset`, `save_map`. *Tests:* round-trip, golden files, per-op units. *Accept:* **a Claude-generated `.tmj` opens in Tiled and renders correctly with real art.** This is the first genuinely valuable milestone.

**P6.5 — Phaser export spike (recommended, ~1 day).** `export_runtime_map` + load one exported map in a bare Phaser scene. De-risks every later phase against "Tiled-correct but Phaser-wrong".

**P7 — Validation.** Rule registry + all K rules, wired into `save_map` and `validate_map`; one broken fixture per rule. *Accept:* every rule fires on its fixture, stays silent on the good one.

**P8 — Review workflow + diff + Tiled bridge.** `status.json` state machine, snapshots, `set_map_state`, `DiffService`, `get_map_diff`, `open_in_tiled` + `scripts/tiled-bridge.mjs`. *Accept:* edit in Tiled -> `get_map_diff` reports exactly what changed, in human terms.

**P9 — Docker.** Dockerfile, `.dockerignore`, compose, non-root, egress pinning, key handling, documented Claude Code config; stdio smoke test in CI. *Accept:* the full tool set works containerized with only `content/` mounted.

**P10 — Port the four floor plans.** Convert the ASCII layouts in `officeLayouts.ts` to `.tmj` (structure via a one-off script; art re-placed from the catalog; zones/seats seeded by running today's generators once, then hand-tuned in Tiled). Reviewed in Tiled, not in-game. *Accept:* four `.tmj` maps validate clean and look right in Tiled.

**P11 — Phaser migration** (separate project, N.3) **+ `packages/map-runtime`.** *Accept:* the game runs a Tiled-authored map end to end: walk it, collide correctly, spawn correctly, zones fire.

**P12 — Retire the old map code.** Delete `props.ts`, `tileset.ts`, `themes.ts`, `officeLayouts.ts`, `schema.ts`; keep the ported collision math. *Accept:* no code path constructs `OfficeMapData`.

**P13+ — Optional:** AI asset generation (quarantined), Automapping via headless Tiled, Streamable HTTP transport.

---

## P. Testing strategy

- **Runner:** Vitest for `tools/map-mcp` and `packages/*` (ESM-native); backend stays on Jest. Add a `test` script per new package so `turbo test` picks it up. **Add CI in P2** — there is none today.
- **Unit:** path security (highest priority, written before the tools); TMJ/TSJ parse; TMJ serialize (golden files); each map operation; each validation rule; each diff change kind; asset search ranking; lockfile verification and sha mismatch handling.
- **Contract:** one `AssetRepository` suite that both `Http` and `Fixture` implementations must pass — this is what makes the API swappable and lets the whole suite run offline.
- **HTTP:** mock the asset API (nock/MSW) for retry, 401, 429, ETag-304, redirect-to-other-host (must be blocked), oversized-payload, and corrupt-image cases. **One opt-in live smoke test** against the real API, skipped without credentials — mocks drift from reality.
- **Integration:** in-process MCP client -> server over an in-memory transport, running whole flows (create -> place -> validate -> save -> export) against a temp workspace with the fixture repository.
- **E2E:** `docker run` the image, issue a tool call over stdio, assert the response.
- **Phaser (P11):** headless-ish scene tests asserting layers, collision, and spawns load from an exported bundle.
- **Not automated:** Tiled GUI round-trip — keep a documented manual checklist per phase.

---

## Q. Asset API — now, not later

Rev 1 planned local manifests with a future remote swap. That inverts: **`HttpAssetRepository` ships in P3**, and the local implementation exists only as a test/offline fixture. The seam still matters — it keeps the whole test suite runnable without network or credentials, and it absorbs API changes in one DTO module. If the API later adds pagination, facets, or a bulk endpoint, `AssetService` shouldn't notice.

---

## R. Risks and key decisions

1. **The asset API is the biggest unknown.** Its real shape isn't in this repo, so P3 is scheduled early and deliberately: build the DTO mapping against a captured real response before anything depends on it. If the API is still in flux, the fixture repository keeps every other phase unblocked.
2. **Vendoring vs live fetch.** *Vendor.* Tiled has no API key, Git must reproduce maps, and the runtime must not depend on a third-party API. Cost: binary files in Git (mitigate with LFS) and an explicit `sync_tilesets` upgrade step — which is a feature, not a tax.
3. **Losing `--network none`.** The container now needs egress. Mitigated by host-pinning, no inbound ports, redirect blocking, and never fetching URLs found in content. Worth stating plainly: this is the security cost of the remote API.
4. **"MCP first, Phaser after" leaves the loop open.** No map renders in-game until P11. Accepted deliberately — Tiled is the review surface until then, and the alternative (a throwaway Pixi image-tilemap renderer) is pure waste. The residual risk is a Tiled-correct map that turns out Phaser-wrong; P7's runtime-compat rules and the P6.5 spike are the cheap insurance.
5. **Losing procedural theming.** Four palette themes disappear with `themes.ts`. "Theme" becomes "which tileset the map uses" — confirm that's acceptable product-wise before P10, since it's user-visible.
6. **Porting the floor plans.** 851 lines of tuned hand-authoring. Rev 1's equivalence test doesn't apply (the renderer changes anyway), so quality control is human review in Tiled. Convert *structure* mechanically, place art deliberately.
7. **Direct TMJ manipulation vs Tiled scripting.** *Direct file I/O* — CI-testable, no GUI, no binary dependency. Automapping later, batch-only.
8. **stdio vs HTTP.** *stdio* — single local developer, no auth surface, lifecycle for free. Keep transport wiring in `index.ts` so Streamable HTTP is a one-file addition.
9. **Git inside vs outside the container.** *Outside* — Claude Code already has Git on the host; mounting `.git` is a large blast radius for a small convenience.
10. **Scope vs the product roadmap.** CLAUDE.md places map tooling at Phase 3 while the product is mid-Phase-1 (presence list still open) and the frontend dev is the stated bottleneck — and the Phaser migration is now a second large frontend project. Sequence honestly: this is real investment, and P1–P8 are the part that pays for itself even if P11 slips.
11. **Stale doc.** CLAUDE.md says "Phaser/PixiJS"; after the migration it's Phaser only. Update it when P11 lands.

---

## S. Recommended implementation order

1. **P1** map-schema — unblocks everything, improves existing code on its own merits.
2. **P2** MCP skeleton + path-jail tests + minimal CI.
3. **P3** Asset API client - *earliest possible, highest unknown.*
4. **P4** TilesetCache + lockfile + `sync_tilesets`.
5. **P5** Tiled read.
6. **P6** Tiled write + map ops - **first real value: Claude authors a map that opens in Tiled with real art.**
7. **P6.5** Phaser export spike (~1 day).
8. **P7** Validation.
9. **P8** Review workflow + diff + Tiled bridge.
10. **P9** Docker.
11. **P10** Port the four floor plans.
12. **P11** Phaser migration + `map-runtime` - **loop closes.**
13. **P12** Delete the old map code.
