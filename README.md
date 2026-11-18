# akira-platform (formerly known as SpringBonk)

A multi-service containerized application for running a ranked-choice book club, plus
three federated side apps — a D&D toolkit, a real-time card game, and a globe you can pin
photos to. Built with a BFF (Backend for Frontend) pattern, OAuth 2.0 authentication, and
micro-frontends.

### Services

Everything is reached through Nginx on `:7080`; the services themselves are not exposed
directly.

| Service | Port | Path | Role |
|---|---|---|---|
| `nginx` | 7080 | `/` | Reverse proxy, static assets, federated remote hosting |
| `spring-bff` | 7081 | `/bff` | OAuth 2.0 client, session state, gateway to downstream services |
| `spring-resource` | 7084 | `/api` | Books, shelves, elections, reviews, notifications, activity |
| `spring-ooze` | 7085 | `/ooz` | Oozengine — D&D compendium and combat tooling |
| `spring-decks` | 7086 | `/dck`, `/dck-ws` | Real-time card games (President), STOMP over WebSocket |
| `jpss-resource` | 7087 | `/jps` | Jo Peace Sticker Service — geotagged photos on a shared globe |
| `keycloak` | 8080 | `/auth` | Identity, roles, OAuth 2.0 token issuance |
| `postgres` | 5432 | — | One database per service |

### Architecture

- **Resource Server** — Spring Boot, PostgreSQL, Liquibase. Handles book data, elections, and
  ranked-choice tallying. Spring Data repositories with explicit `@Query` and `Pageable` paging.
- **Authentication Server** — Keycloak with a dedicated PostgreSQL instance. Manages user
  identity, roles, and OAuth 2.0 token issuance. The BFF handles token exchange so the frontend
  never touches tokens directly.
- **Backend-For-Frontend** — Spring Boot Cloud Gateway. Aggregates downstream calls, manages
  session state, and acts as the OAuth 2.0 client. Sits behind Nginx as a reverse proxy.
- **Jo Peace Sticker Service** — Spring Boot. A photo wall with coordinates: anyone can read
  it without an account, a signed-in user can pin a picture with a comment, and a sticker can
  only be edited or removed by the account that placed it. Uploads are decoded and re-encoded
  on the way in (which drops EXIF, including a photo's own GPS tags) into a capped display
  image and a small tile for the globe; both live in their own table so listing the wall never
  reads a photo.
- **Decks** — Spring Boot. Authoritative game engine with a STOMP broadcaster over WebSocket.
  Clients authenticate the CONNECT frame with a short-lived ticket; the session principal is the
  Keycloak subject. Runs on the in-memory simple broker — scaling past one instance means
  swapping in a RabbitMQ STOMP relay.
- **Frontend** — Angular 22, standalone components, signals, zoneless change detection,
  Tailwind CSS v4. A host shell plus two federated remotes (see below).
- **Infrastructure** — Docker Compose for local orchestration. Each service runs in its own
  container with isolated networking. Nginx handles routing, static assets, and serving the
  federated remotes. The local compose stack is plain HTTP — `certs/` is a placeholder and no
  TLS is configured, so don't point anything public at it as-is.

### Frontend layout

The Angular workspace lives in `angular-client/akira-ng` and builds four projects wired with
Angular Native Federation:

| Project | Kind | Served at |
|---|---|---|
| `akira-ng` | Host shell — book club, dashboard, auth, navigation | `/` |
| `ooze` | Remote — Oozengine compendium and dice | `/remotes/ooze/` |
| `president` | Remote — President card game (WebGPU table) | `/remotes/president/` |
| `jpss-ui` | Remote — Jo Peace Stickers (MapLibre globe) | `/remotes/jpss-ui/` |

Remotes are loaded lazily through `loadRemoteModule`, and the host degrades to an
"unavailable" route when a remote or its backend is down — the home page and nav both gate on
live health checks rather than assuming everything is up. A new remote has to be listed in
`public/federation.manifest.json` as well as in `angular.json`; without it the host cannot
resolve the name and every route into it falls back to "unavailable".

> **Sticker globe note:** `jpss-ui` is the only project that uses maplibre-gl and deck.gl, and
> its federation config `skip`s that whole graph rather than sharing it. Native Federation builds
> each shared package into its own *self-contained* chunk — it does not externalise one shared
> package from inside another — so a diamond gets duplicated. deck.gl is a diamond:
> `@deck.gl/core` and `@deck.gl/layers` both sit on `@luma.gl/shadertools`, and two copies means
> deck registers its shader hooks on one `ShaderAssembler` while every layer compiles against the
> other, so every fragment shader fails at runtime from a build that was green. Declaring the luma
> packages as dependencies does not help; it only adds chunks nothing imports. Skipping puts the
> graph through esbuild, where it deduplicates normally.

> **Tailwind note:** the remotes have no Tailwind build of their own. The host's Tailwind scan
> reaches into the remotes' templates and emits their classes, so after editing a remote's
> markup you must rebuild the **host** for new utility classes to exist.

### Running it locally

Prerequisites: JDK 27, Node (see `.nvmrc`), Docker.

Start the infrastructure (Postgres, Keycloak, Nginx):

```bash
docker compose up -d
```

Build and test the Maven reactor:

```bash
JAVA_HOME=$(/usr/libexec/java_home -v 27) ./mvnw verify
```

Build and test the frontend:

```bash
cd angular-client/akira-ng && npm ci && npx ng build akira-ng && npx ng test akira-ng --watch=false
```

The remotes build separately (`npx ng build ooze`, `npx ng build president`,
`npx ng build jpss-ui`), or all of them at once with `./devbuildall.sh`. Build the host first —
see the Tailwind note above.

### Database backups

The `pg-backup` sidecar dumps the whole cluster to `./backups` at local midnight
and keeps the three most recent copies. It comes up with the rest of the stack;
nothing else is needed.

```bash
docker compose up -d pg-backup
```

It uses `pg_dumpall`, so one file carries all five databases *and* the roles with
their passwords. That matters because `init-db.sh` only runs against an empty
volume — a per-database dump would have nothing to load into on a cluster whose
roles are gone.

Take one immediately, outside the schedule:

```bash
docker exec pg-backup /opt/backup/pg-backup.sh once
```

Restore the newest backup (or pass a specific file). The dump is `--clean
--if-exists`, so it drops and recreates every database it contains; stop
Keycloak and the services first, since Postgres will not drop a database that
still has sessions attached:

```bash
./backup/pg-restore.sh
```

Retention count and schedule timezone are `BACKUP_RETAIN` and `BACKUP_TZ` in
`.env`. `backups/` is gitignored.

Deploying elsewhere is not just a `git pull`: the compose file here is
local-only, and a deploy host has its own alongside its own `.env`. What that
compose needs:

- `BACKUP_SCRIPT_DIR` pointing at this repo's `backup/` directory, wherever the
  checkout sits relative to it — then `git pull` is enough to update the script.
  Mount the *directory*, not the script itself: a single-file bind mount on
  Linux is pinned to the inode, and `git pull` replaces files by rename, so a
  file mount leaves the running container executing the pre-pull copy with
  nothing on disk to show for it. (This does not reproduce on Docker Desktop,
  which resolves shares by path.)
- `PG_HOST` set to whatever the Postgres service is called there.
- `image:` matched to the deployed Postgres — `pg_dumpall` can dump an *older*
  server but refuses a newer one.
- A writable backup directory on a disk with room for three copies. `jps-db`
  holds photo blobs, so those dumps are not small the way the local ones are.
- `depends_on` is optional, and so is a healthcheck on the Postgres service:
  the script polls `pg_isready` before every dump, so a Postgres that is slow to
  start or mid-restart at midnight is waited out rather than missed.

The sidecar has a healthcheck of its own, and it asserts the *artefact* rather
than the process: a non-empty `pgcluster-*.sql.gz` written within the last 26
hours (24h schedule plus slack). A backup container's failure mode is silence —
it sleeps a day at a time, so a broken one looks exactly like a working one from
`docker ps`. This way a missed, empty, or truncated dump shows up as `unhealthy`.

`pg-restore.sh` takes the backup directory or a specific dump as its argument
rather than deriving one from its own location — where backups live is a
property of the deployment, so a wrapper script or alias passes it in. It reads
credentials from the running Postgres container, so there is no `.env` to find.

### Patterns & Approach

- **BFF as security boundary** — the frontend is a public client with no token storage; all OAuth
  flows route through the BFF, which holds tokens server-side and proxies authenticated requests
  downstream.
- **Database-per-service** — Keycloak, the resource server, Oozengine, and Decks each own their
  own PostgreSQL database. No shared schemas, no cross-service joins.
- **Liquibase migrations** — schema changes are version-controlled and applied at startup, keeping
  environments reproducible. Hibernate runs with `ddl-auto: validate` so entities are checked
  against the migrated schema rather than driving it.
- **Ranked-choice tallying** — elections resolve using instant-runoff voting with configurable
  round logic, and expose the round-by-round breakdown.
- **Micro-frontends over a monolith SPA** — side apps ship and fail independently of the shell.
- **Re-encode, don't relay** — the sticker service never serves back bytes it did not decode
  itself. An upload is read, size-checked from its header before its pixels, and written out
  fresh, so a public wall cannot be used to host whatever a "PNG" actually contained.
- **One draw call, not one element per sticker** — the globe's marks are a deck.gl layer, so
  drawing cost is flat in the number of stickers. `StickerIconLayer` is a small custom layer
  rather than deck's own `IconLayer`, which renders nothing under `_GlobeView` with `billboard`
  on (reproducible with deck 9.3.11 standalone: the same data draws three icons under `MapView`
  and zero under `_GlobeView`, while a ScatterplotLayer beside it draws all three). It is built
  on the vertex path that does survive the globe — ScatterplotLayer's — and samples one shared
  atlas rasterised from the project's sticker glyph.
- **Virtual threads** — request handling runs on Java virtual threads in the resource, Oozengine,
  and Decks services (`spring.threads.virtual.enabled`). The BFF stays reactive on WebFlux.
- **Test-driven** — JUnit and Mockito on the backend; Vitest with the Angular `unit-test` builder
  on the frontend.

### CI & Security

- **`ci.yml`** — builds and tests the Maven reactor on JDK 27 (Testcontainers-backed slices
  included), then builds all three Angular projects and runs the frontend suites.
- **`codeql.yml`** — CodeQL code scanning for `java-kotlin` (built via Maven), for
  `javascript-typescript`, and for the workflow files themselves. Runs on push, PR, and weekly.
- **Dependabot** — weekly grouped updates for Maven, npm, Docker, and Docker Compose, with a
  cooldown so brand-new releases settle before a PR opens.
- **`.github/SECURITY.md`** — supported versions and vulnerability reporting.

### Conventions

**Code tags**

- `LOCK_IN_POINT` — marks non-agnostic code (vendor or implementation lock-in)
- `TODO` / `TODO TEST` — outstanding work and missing tests
- `CHOICE` — development decisions that may change
- `SEE` — links to reference material

**Log format**

`[CLASS] Content of log`

---

# Oozengine

A D&D Dungeon Master toolset and combat balancer/simulator, integrated as an additional
microservice in the akira-platform ecosystem. Spring Boot, PostgreSQL, JPA/Hibernate, Liquibase —
secured as an OAuth 2.0 resource server behind the BFF and built downstream of the platform
parent POM.

### Patterns & Approach

- **Module of the platform reactor** — builds from the shared parent POM (Spring Boot 4 / Java 27),
  inheriting dependency and plugin management rather than a standalone Spring Boot parent.
- **Secured resource server behind the BFF** — validates Keycloak-issued JWTs via spring-addons; the
  BFF routes `/ooz/**` with token relay, so the Angular client never handles tokens directly.
  Method-level security is enabled for write paths.
- **Database-per-service** — owns a dedicated `ooz-db` Postgres database. Liquibase owns all DDL;
  Hibernate runs with `ddl-auto: validate` to confirm entities match the migrated schema at startup.
- **Virtual threading** — request handling runs on Java virtual threads (`spring.threads.virtual.enabled`).
- **Configurable simulation** — combat balancing is designed around pluggable rulesets, so encounter
  parameters (action economy, terrain modifiers, CR calculations) can be swapped without rewriting
  core logic.
- **Event-driven messaging (planned)** — Apache Pulsar for cross-service game events is on the
  roadmap; the starters were deferred until there are producers and consumers to wire.

### Data Progress

| Category | Status |
|---|---|
| Skills | ✓ |
| Feats | ✓ |
| Tools | ✓ |
| Equipment (base) | ✓ |
| Backgrounds | ✓ |
| Species | in progress |
| Traits | in progress |

### Combat & Items

| Category | Status |
|---|---|
| Base Weapons | ✓ |
| Base Armor | ✓ |
| Custom Weapons | planned |
| Custom Armor | planned |
| Mounts & Vehicles | planned |
| Spells | planned |
| Classes | planned |
| PCs | planned |
| NPCs | planned |
| Monsters | planned |

### Systems

| Category | Status |
|---|---|
| Module under platform parent POM | ✓ |
| Secured resource server behind BFF | ✓ |
| Database-per-service (ooz-db) | ✓ |
| JPA + Liquibase (validate) | ✓ |
| Pulsar system stream | planned |
| Pulsar applied to all services | planned |
| Actions | planned |
| Terrain & geography | planned |
| Game feeds via Pulsar | planned |

---

# President

A real-time multiplayer card game (President, a.k.a. Asshole) served as a federated Angular
remote against the `spring-decks` service.

### Two ways to play

- **Solo vs bots** — the remote carries its own TypeScript rules engine (`game/engine.ts`) and bot
  policy, so a single player can start a game immediately with no lobby and no server round trip.
- **Live multiplayer** — `spring-decks` runs the authoritative `PresidentEngine`; the client sends
  intents over STOMP and renders the state it gets back.

The rules therefore exist in two implementations, Java and TypeScript, which have to agree.
Both sides are covered by tests that play out full games; treat any rule change as a change to
both engines.

### Patterns & Approach

- **STOMP over WebSocket** — commands go up over STOMP, state fans out through a broadcaster.
  The CONNECT frame carries a short-lived ticket, and the session principal is the Keycloak
  subject. The server runs the in-memory simple broker today.
- **Pure engines, testable in isolation** — neither engine depends on its framework or transport,
  so both are exercised by playthrough tests that drive complete games.
- **WebGPU table** — the card table renders through WebGPU.
- **House rules** — two decks, no jokers, 104 cards; twos are high, the winner of a trick leads the
  next, and the President/Asshole exchange runs between rounds.
