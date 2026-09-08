# Planned work

Things we know we want, deliberately not built yet. Each entry says what the
current design is, what it becomes, and — the part that matters — **what makes
it urgent**, so nobody does it early and nobody misses the moment.

Bugs and papercuts live in `KNOWN_ISSUES.md`. This file is for accepted debt.

---

## 1. Get JPSS image bytes off the volume Keycloak lives on

**Today.** `jpss-resource` stores both renditions of every photo as `BYTEA` in
`sticker_image`: a display image capped at 1600px on the long edge and a 960px
thumbnail. Uploads are capped at 8MB each.

**The per-user rate limit is done.** `StickerService` enforces a 250-sticker cap
and a rolling 15-uploads-per-hour window before `ImageProcessor` runs, so a
rejected upload costs a row count rather than a decode
(`jpss.limits.stickers-per-user`, `.uploads-per-window`, `.window`). That was
half of this item; the storage half is what is left, and the limit is what buys
the time to do it properly — growth is now bounded rather than open-ended:

| | display+thumb |
|---|---|
| one user at the cap | 76 – 161 MB |
| 10 users at the cap | 0.7 – 1.6 GB |
| 50 users at the cap | 3.7 – 8.1 GB |

**What makes it urgent.** One trigger, and it is not size on its own: all seven
databases live in a single `postgres:18.6` container on one `postgres_data`
volume, and `auth-db` is Keycloak's. Filling that volume does not degrade
stickers — it takes down authentication for every service in the stack. The
coupling is the problem. Read the table above as "how many users before the
shared volume is at risk", not as a storage bill.

### The decision: not MongoDB

Mongo was the standing plan here and it is the wrong tool, for reasons that only
became clear once the requirement was written down plainly: **we want to fetch an
opaque byte array by UUID.** That is the one workload a document database has no
advantage in. Mongo earns its keep on rich, queryable, schema-flexible
*documents*; ours would be a `_id` and a `BinData`, which is a key-value store
with a query planner attached.

What it would cost, specifically:

- **A hardware gate.** MongoDB 5.0 and later require **ARMv8.2-A** on arm64. The
  Pi 4's Cortex-A72 is ARMv8.0-A, so every 5.x/6.x/7.x/8.x build dies with
  `Illegal instruction (core dumped)` — not a config problem, an unsupported
  instruction set. Pi 5 (Cortex-A76) is ARMv8.2-A and is fine. **If this is a
  Pi 4, the option does not exist** short of pinning 4.4.18 or building from
  source with `-march=armv8-a`, neither of which is a thing to run in 2026.
- **Memory on a box that has none spare.** WiredTiger's default cache is half of
  RAM minus 1GB. Alongside Postgres, Keycloak and five Spring JVMs that has to
  be pinned with `--wiredTigerCacheSizeGB` or it will win the OOM fight.
- **A second engine to back up, monitor and upgrade**, for bytes that need
  neither queries nor indexes.
- **It does not avoid the consistency problem.** Bytes outside Postgres means a
  sticker row and its image can no longer be written or deleted in one
  transaction, so you need orphan cleanup and a reconciliation story. Every
  non-Postgres option below pays this; Mongo is not cheaper for paying it.
- GridFS is not needed either way — our images are far under the 16MB BSON
  limit, so plain `BinData` would do. Worth saying because reaching for GridFS
  reflexively is the usual mistake.

### What to do instead, in order

**Now — a second Postgres instance for `jps-db`.** This fixes the *stated*
problem, which is volume coupling, not Postgres's fitness for blobs. One compose
service with its own volume, one `JPS_DATASOURCE_URL` change, **zero code**.
Keeps the image write inside the same transaction as the sticker row, keeps one
backup tool, keeps one thing to learn. Nothing above can fill Keycloak's disk
any more, which was the entire point.

**Later, if bytes outgrow the Pi's disk or its upstream link — object storage.**
The trigger to watch is bandwidth, not gigabytes: serving 400kB photos from a
home connection is the constraint that will actually bite first, and no local
store fixes it. At that point the honest answer is a hosted bucket with a CDN in
front — **Cloudflare R2** (zero egress fees) or Backblaze B2 — because getting
photo traffic off the home uplink is the whole win. If it must stay in the
house, **Garage** is the right shape: a single Rust binary and a config file,
built for exactly this scale. Note that **MinIO is now a trap** — the admin UI
was stripped from Community Edition in 2025 and the project entered maintenance
mode in December 2025.

**Not the filesystem.** It is the cheapest option and it does work, but it trades
one shared-volume coupling for another and gives up atomic delete, and the
compose bind-mount would need care to survive a container rebuild. If the second
Postgres is rejected, this is the fallback, not the first choice.

**Already done, unconditionally.** Changeset `004` sets both blob columns to
`STORAGE EXTERNAL`. `bytea` defaults to `EXTENDED`, which runs a compression
pass over every value; JPEG is already entropy coded, so that pass reliably
saves nothing and we were paying the CPU for it on a Pi. This is a win under
every option above and is independent of all of them.

Watch it with `pg_total_relation_size('sticker_image')` from the deploy notes.

---

## 2. Slim the wall payload, load metadata and images on demand

**Today.** `GET /jps/stickers` returns every sticker with its full metadata in
one unpaginated response (`findAllByOrderByCreatedAtDesc`), and the globe holds
all of it in memory. Images are already separate — the globe draws a shared
glyph, not thumbnails — so the payload is metadata only.

**Why it is fine for now.** Tens to hundreds of stickers is a small JSON
document, and having every point resident is what makes the globe feel instant:
no fetch on pan, no popping in as you spin.

**Deliberately not pagination.** We want *all* the points on the globe at once —
that is the product. Paging the wall would mean stickers appearing as you scroll
a map, which is the wrong experience.

**What it becomes.** Split the endpoint by what each part is for:

- A **slim point list** — id, longitude, latitude, and whatever the mark's colour
  depends on (author id, so "mine" still renders). Nothing else. This stays
  unpaginated and loads everything, as now, and it is what feeds the deck layer.
- **Metadata on demand** — `GET /jps/stickers/{id}` when a sticker is clicked,
  populating the sidebar. Cache per id client-side so reopening one is free.
- **Image on demand** — already how it works; the sidebar's `<img>` is the first
  time bytes are fetched, and the response is cached for a week with an ETag.

The result is that the globe's cost scales with point *count* rather than
content, and opening a sticker costs one small request.

**What makes it urgent.** When the initial payload gets big enough to delay first
paint of the globe. The point list is a few dozen bytes per sticker, so that is a
long way off — likely tens of thousands of stickers.

---

## 3. OpenAPI docs — locked down in prod; decide if the team ever needs them

**Done, differently from the original plan.** All four resource servers
(`jpss-resource`, `spring-ooze`, `spring-resource`, `spring-decks`) now set the
following in `application-prod.yml`:

```yaml
springdoc:
  api-docs:
    enabled: false
  swagger-ui:
    enabled: false
```

Verified: under `--spring.profiles.active=prod`, `/v3/api-docs` and
`/swagger-ui.html` both return **404**, and the startup warning about the docs
endpoint being enabled is gone. Without the profile they still return 200, so
local Swagger UI is untouched.

**Why disabling beat the original "drop the permit-all entries".** The plan was
to remove `/swagger-ui*/**` and `/v3/api-docs*/**` from every `permit-all` list
so the docs would require a bearer token. Disabling is the stronger control: a
path that does not exist cannot be exposed by a routing mistake, whereas a path
that merely wants a token is one misconfigured gateway route from being
readable. It also costs nothing in dev, where token-gating Swagger UI is pure
friction and there is nothing to protect. **The permit-all entries were
deliberately left in place** — in prod they now match nothing.

**What is left, and it is a question rather than a task.** The docs are now
unreachable in prod by anyone, including us. If the team ever wants them there,
the fix is a BFF gateway route with `TokenRelay` and flipping `enabled` back on
for that service — **not** widening `permit-all`, which is the tempting wrong
answer and the reason this entry stays in the file.

---

## 4. Narrow the CORS policy on `/api/`, and fix two nginx-specific defects

**Today.** The `/api/` location in `nginx/conf/default.conf` proxies to a
host-side service on `:7001` and adds:

```nginx
add_header 'Access-Control-Allow-Origin' '*';
add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS, PUT, DELETE';
add_header 'Access-Control-Allow-Headers' '*';
```

`*` declares everything under `/api/` readable by every website on the internet.

**Why it is fine for now — conditionally.** `*` and credentials are mutually
exclusive: browsers will not send cookies to a wildcard origin and reject the
response if forced. So anything cookie-authenticated is safe by accident.

The open question is whether `:7001` is trusted for some *other* reason — being
on the host network, sitting behind the proxy, or simply never expected to be
called from a browser. If so, `*` converts a network-position trust boundary
into a public one, using visitors' browsers to do the reaching. **Answer that
before deciding this entry is low priority.**

**Two defects that are wrong regardless of the answer.**

- **No `always`.** nginx applies `add_header` only to 2xx/3xx, so 4xx and 5xx
  responses carry no CORS headers and a cross-origin caller sees an opaque
  failure instead of the real status.
- **It silently drops server-level headers.** A location with its own
  `add_header` does not inherit the server's — the comment above the HSTS block
  in `default.conf` already says this. This location has three, so any security
  header added at server level will not apply to `/api/`. That one is live now.

Also worth knowing: `add_header` appends rather than replaces. If the upstream
sets its own `Access-Control-Allow-Origin`, the browser sees two and rejects both.

**What it becomes.** Named origins instead of `*`, `always` on each header, and
`Access-Control-Allow-Credentials` only if the answer above says it is wanted.
If `/api/` turns out to be genuinely public data, keep `*` and just fix the two
defects.

---

## 5. Make the nginx default server explicit

**Today.** No server block is marked `default_server`, so an unmatched `Host`
falls through to the first block declared for that address:port in config-load
order — and `conf.d` loads alphabetically, so that is `default.conf`'s first
`:443` block, the www→apex redirect.

Measured against a replica of the current `conf.d`:

| Port | `Host` | Answering block |
|---|---|---|
| 443 | `akira-app.io` | the real app |
| 443 | `www.akira-app.io` | www→apex redirect |
| 443 | `findjo.org` | findjo |
| 443 | `evil.example` | **www→apex redirect** |
| 443 | `evil.example`, path `/bff/` | **www→apex redirect** — never reaches a proxy |

**Why it is fine for now.** An unmatched `Host` gets a 301 and never touches a
proxied location, so no `X-Forwarded-Host` is forwarded anywhere. This is not a
hole today.

**What makes it urgent.** "First block in config-load order" is an implicit
dependency on **filenames**. Add a conf that sorts before `default.conf`, or
rename one, and whichever block lands first silently becomes the fallback — and
if that block has a proxied location, an arbitrary `Host` starts reaching it
with `X-Forwarded-Host: $host`. The trigger is somebody adding a domain, which
is exactly what we now do routinely.

**What it becomes.** An explicit catch-all on both ports that closes the
connection without responding, so the fallback stops depending on file naming:

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;
    ssl_certificate     /etc/letsencrypt/live/akira-app.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/akira-app.io/privkey.pem;
    return 444;
}
```

Note this must not shadow the ACME challenge: `certbot` validates over HTTP on
port 80, so either keep the `/.well-known/acme-challenge/` location in the
catch-all too, or leave port 80 alone and add `default_server` on 443 only.

---

## 6. Decide whether findjo.org gets its own Keycloak client, or realm, or neither

Open question, not a task. Nothing is blocked on it — record the answer here
when there is one.

**Today.** One realm, one client (`local-keycloak-confidential`), shared by both
domains. findjo.org logins work because
`MultiHostAuthorizationRequestResolver` rebuilds `redirect_uri` from the
forwarded host (gated by `bff.allowed-client-origins`) and findjo.org's URIs are
registered on that client. Same users, same credentials, same `sub` on both
domains — so a person owns the same stickers wherever they signed in.

**Why it is fine for now.** It works, and one shared user pool is currently the
right answer: findjo.org is another front door onto the same wall, not a
separate community.

**The question is what you are separating.** Three different answers:

- **Just working logins** — already done, nothing to do.
- **Separate secret / roles / token lifetimes** — a second *client* in the same
  realm. Users, credentials and `sub` are unchanged, so resource servers need no
  change at all: same issuer, single `ops` entry. Buys blast-radius isolation if
  one client's secret leaks, client-scoped roles, and `azp` in the token telling
  you which front door a request came through.
- **Separate people** — a second *realm*. Its own user store and its own `sub`
  namespace. Resource servers accept both by listing a second `ops` entry
  (`ops` is a `List`, matched on the token's `iss` claim), so that part is
  config. But it forks identity, and that is where it stops being cheap — see
  below.

**What a realm drags in that a client does not.** There is no tenancy in the
sticker data: `GET /stickers` returns every row, `keycloak_user` is keyed on
`sub` with no realm column, and ownership is per-`sub`. Two realms therefore
means two communities posting to one shared globe. Making the walls separate is
the real work — a tenant column on `sticker` and `keycloak_user`, filtering on
every read, and a ruling on whether the same human in both realms is one
identity or two. Settle the shared-wall question *before* the auth work; it
decides whether any of it is worth doing.

**Common to a client or a realm** — either way there are two registrations, so
two code changes are needed:

- `LoginOptionsController` must filter by forwarded host and return only that
  domain's registration. It currently returns all of them and the frontend takes
  `options[0]`, which is `HashMap` iteration order.
- `MultiHostAuthorizationRequestResolver`'s flat origin allowlist becomes a
  host → registration map, so a mismatch is refused at the BFF instead of
  bouncing off Keycloak with an opaque error.

**Trap, whichever way this goes.** `KC_HOSTNAME` is pinned to
`https://${SITE_URL}/auth`, so every login page renders on akira-app.io and the
address bar changes mid-login for findjo.org users. Unsetting it so Keycloak
derives the hostname from forwarded headers fixes the cosmetics and breaks the
resource servers: the `iss` claim would then vary by hostname, and issuer
matching is exact string comparison, so you would need an `ops` entry per realm
*per hostname*. Keep it pinned.

**What makes it urgent.** findjo.org wanting its own signups (realm), or
deciding the akira client secret leaking should not take findjo.org with it
(client). Neither is true today.

---

## 7. Put Redis in front of the resource servers

**Today.** There is **no caching layer anywhere in the stack.** Not in
`jpss-resource`, not in `spring-ooze`, `spring-resource` or `spring-decks`.
Every read is a round trip to Postgres, every time. Spring's cache abstraction
is not wired up in any service — there is no `@EnableCaching`, no cache manager,
and therefore not even an in-process fallback.

**Why it is fine for now.** The read volume is a handful of people and Postgres
on the Pi is not breathing hard. Nothing is slow because of this yet.

**What makes it urgent.** The first one of these to happen:

- **The globe's wall query.** `GET /jps/stickers` is unpaginated by design (see
  item 2 — we *want* every point resident) and every visitor runs it on load.
  It is the most cacheable request in the system: identical for everyone, and
  only invalidated when someone posts or deletes. Today each page load is a full
  table scan's worth of work.
- **Image bytes.** Already served with a week-long `Cache-Control` and an ETag,
  so browsers and any CDN handle repeats — but a cold client still pulls
  hundreds of kB through Postgres and the JVM. This one gets *more* interesting,
  not less, if item 1 moves the bytes to a second store.
- **Keycloak user lookups.** `keycloak_user` is read on essentially every
  authenticated request to resolve `sub` to a local row. Small, hot, almost
  never changes — the textbook cache entry.

**What it becomes.** A Redis container on the compose network, one
`spring-boot-starter-data-redis` dependency and `@EnableCaching` per service,
with `@Cacheable`/`@CacheEvict` on the three cases above. Namespace the keys per
service (`jpss:`, `ooze:`, …) so one Redis can serve all four without them
colliding; a shared instance is right at this size and the prefix is what keeps
that from becoming a mistake.

**Do the easy version first.** If a single Redis is unwelcome operationally,
`@EnableCaching` with the default in-process `ConcurrentMapCacheManager` gets
most of the win for one annotation and zero infrastructure — each service caches
its own hot reads in heap. That is strictly worse across restarts and cannot be
shared or invalidated across services, so it is a step rather than the answer,
but it is a cheap step and it makes the `@Cacheable` placement work reusable.

**Sequencing note.** Redis is also the natural home for the rate-limit counters
in item 1, which today are `count(*)` queries against `sticker`. Not a reason to
do it sooner — the counts are cheap and correctness matters more than speed
there — but if Redis lands, that is the second thing to move onto it.
