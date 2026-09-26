# microgpt-comms — putting it on the server

Every route to a person on outpostmessaging.com. Two forms post here and nothing
else does: `/reports` takes an abuse report the app wrote, `/messages` takes
anything else. There is no address published on the site or in the app, so this
service is the whole of the contact surface.

Port **7088**, nginx prefix **`/cms`**, database **`cms-db`**.

---

## 1. Make the database

`init-db.sh` only runs the first time Postgres initialises an empty volume, and
yours is not empty — so the `CMS` block added to that script is for a future
rebuild, and today the same thing is done by hand.

Run this on the server. Pick a real password first and use the same one in step 2.

`$POSTGRES_USER` lives inside the container, not on your shell. Left to the host
it expands to nothing, psql falls back to the OS user of the exec — `root` — and
the server says `role "root" does not exist`. `sh -c` with single quotes hands the
expansion to the container, which is the same thing the compose healthcheck does
with `$$POSTGRES_USER`.

```bash
docker exec -i pgsql sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER"' <<'SQL'
CREATE DATABASE "cms-db";
CREATE ROLE "cms_user" LOGIN PASSWORD 'PUT_A_REAL_PASSWORD_HERE';
ALTER DATABASE "cms-db" OWNER TO "cms_user";
GRANT ALL PRIVILEGES ON DATABASE "cms-db" TO "cms_user";
SQL
```

Then the schema ownership, so Liquibase can create tables when the service boots:

```bash
docker exec -i pgsql sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d cms-db' <<'SQL'
ALTER SCHEMA public OWNER TO "cms_user";
GRANT USAGE, CREATE ON SCHEMA public TO "cms_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO "cms_user";
GRANT USAGE,  SELECT, UPDATE          ON ALL SEQUENCES IN SCHEMA public TO "cms_user";
SQL
```

Check it took:

```bash
docker exec -i pgsql sh -c 'psql -U "$POSTGRES_USER" -lqt' | grep cms-db
```

Liquibase creates `abuse_report`, `contact_message` and their indexes on first
boot. Nothing else to run.

---

## 2. Environment

Add to `.env`. **Everything marked FILL IN has no working default** — the service
starts without them and stores what arrives, but no mail goes out and
`notified_at` stays null on every row.

```bash
# ---- Database (step 1) ----
CMS_DATASOURCE_URL=jdbc:postgresql://pgsql:5432/cms-db
CMS_DATASOURCE_NAME=cms-db
CMS_DATASOURCE_USERNAME=cms_user
CMS_DATASOURCE_PASSWORD=          # FILL IN — the password from step 1

# ---- Where a report goes ----
CMS_REPORT_TO=abuse@outpostmessaging.com
CMS_MESSAGE_TO=info@outpostmessaging.com
CMS_REPORT_FROM=                  # FILL IN — the envelope sender. Most relays
                                  # insist this is an address on the same domain,
                                  # and often the one the credentials belong to.
CMS_SITE_URL=https://outpostmessaging.com/report

# ---- SMTP ----
CMS_SMTP_HOST=                    # FILL IN
CMS_SMTP_PORT=587
CMS_SMTP_USERNAME=                # FILL IN
CMS_SMTP_PASSWORD=                # FILL IN
CMS_SMTP_AUTH=true
CMS_SMTP_STARTTLS=true

# ---- Who may post the forms ----
CMS_ALLOWED_ORIGINS=https://outpostmessaging.com

# ---- Wiring ----
PORT_CMS=7088
PREFIX_CMS=/cms
```

`CMS_REPORT_TO` and `CMS_MESSAGE_TO` are **not published anywhere**. They are
where this service delivers, not where anybody is invited to write, which is why
the abuse address can now be a mailbox nobody outside the machine knows.

**On SMTP.** Keycloak already sends mail from this machine, so whatever host,
port and credentials its realm uses will work here — copy them across rather than
setting up a second relay. Port 587 with STARTTLS is the usual shape; if
Keycloak's realm is on 465 instead, set `CMS_SMTP_PORT=465`,
`CMS_SMTP_STARTTLS=false` and add `CMS_SMTP_SSL=true` (you will need a matching
`mail.smtp.ssl.enable` line in `application.yml` — say the word and I will add
it). Residential ISPs routinely block outbound 25, which is why a relay is the
only thing that works from a Pi at home.

---

## 3. nginx

Add inside the `server` block, beside `/jps/`:

```nginx
# Report and contact intake. The forms on outpostmessaging.com post here.
location /cms/ {
    rewrite ^/cms/(.*) /$1 break;
    proxy_pass http://host.docker.internal:7088/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

The request cap is 256 KB, well under nginx's own 1 MB default, so
`client_max_body_size` needs nothing. That is deliberate: a report is about a
kilobyte, and there is no file input on either form to hand a photograph to.

### A blog post's link preview

A crawler reading `/blog/<slug>` does not run the page, so nginx builds the
post's `<head>` for it. outpost-site's build writes `blog-post.html`, the site's
shell with an SSI include where the head goes; this service answers the include
at `GET /blog/posts/<slug>/head`. Add inside the same `server` block, beside
`location /`:

```nginx
# A blog post: the site's shell, with the post's own <head> from comms.
location ~ ^/blog/(?<post>[a-z0-9-]+)$ {
    ssi on;
    ssi_silent_errors on;
    try_files /blog-post.html =404;
    add_header Cache-Control "no-cache" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
}
```

A draft or an unknown slug answers 404 with no body, and so does nothing when
the service is down; either way the shell's own blog head is used and the page
still loads. The slug pattern is `BlogSlugs`'s, so no other address reaches the
include. `OUTPOST_URL` has to be `https://outpostmessaging.com`, or the canonical
and image addresses name the wrong host.

---

## 4. Build and run

```bash
JAVA_HOME=$(/usr/libexec/java_home -v 26) ./mvnw -B -ntp -pl microgpt-comms -am verify
docker build -f DockerfileComms -t microgpt-comms .
```

Check it came up, and that Liquibase ran:

```bash
curl -s localhost:7088/actuator/health/readiness
docker exec -i pgsql sh -c 'psql -U "$POSTGRES_USER" -d cms-db -c "\\dt"'
```

---

## 5. Prove the refusal before you trust it

The one behaviour that matters is that nothing but a report can get in. Test it
against the running service rather than taking the unit tests' word:

```bash
# Should be refused with 422 and a sentence: it is not a report.
curl -i -F report='hello' -F category=other -F email=you@example.com \
  http://localhost:7088/reports

# Should be refused with 400 — no way to reach the reporter.
curl -i -F report="$(cat a-real-report.txt)" -F category=threat \
  http://localhost:7088/reports

# Should be accepted, and should mail CMS_MESSAGE_TO.
curl -i -F product=outpost -F category=question -F title=Test \
  -F description='Checking the contact form.' -F email=you@example.com \
  http://localhost:7088/messages
```

---

## 6. Where the reports live, and what backs them up

There is no separate vault, and there should not be one. The reports are rows in
`cms-db` in the Postgres container, on the volume that database already uses, and
everything that protects the rest of that cluster protects them:

| | |
|---|---|
| **The volume** | The `postgres` service's existing named volume. `cms-db` is a database in the same cluster, not a second container, so nothing new to mount and nothing new to back up. |
| **Nightly** | `pg-backup` already runs `pg_dumpall` at local midnight into `./backups` and keeps **three**. It picked up `cms-db` the moment Liquibase created it — no change was needed. |
| **Weekly** | `pg-backup-report` mails a note saying whether that actually happened. It is new and the reason is below. |

**What a report contains, which is what makes the rest of this bearable:** an
account of an event, the means to contact the reporter, and the app's own report
naming a message by a hash. Never the message, never a photo, never anything the
reporter was sent. The intake refuses everything that is not the app's report, so
the worst thing this database can ever hold is somebody's description of what
happened to them. That is still worth protecting; it is not the thing a vault was
imagined for.

**What "deleted" is worth, exactly.** Deleting a row does not delete it from the
three nightly dumps, so a deleted report survives on disk for up to three more
days. The site says that in those words on /resources rather than promising a
deletion the backup would make untrue.

### The weekly note, and why it is a note

`pg-backup` sleeps twenty-four hours at a time, so a backup that has stopped and
a backup that is working look exactly alike until somebody goes and looks. The
compose healthcheck asserts the artefact, which catches it — if anybody is
watching the healthchecks.

`pg-backup-report` mails once a week: how old the newest dump is, what is
retained, each file's size and SHA-256, and a subject line that says
`BACKUPS ARE NOT RUNNING` when the newest one is over 26 hours old.

```bash
# ---- Weekly backup note ----
BACKUP_MAIL_TO=you@example.com    # FILL IN
BACKUP_MAIL_FROM=                 # FILL IN — same envelope-sender rule as above
BACKUP_SMTP_HOST=                 # FILL IN — the same relay Keycloak uses
BACKUP_SMTP_PORT=587
BACKUP_SMTP_USERNAME=             # FILL IN
BACKUP_SMTP_PASSWORD=             # FILL IN
BACKUP_REPORT_WEEKDAY=0           # 0 = Monday
BACKUP_REPORT_HOUR=8
BACKUP_STALE_HOURS=26
```

Try it before trusting the schedule:

```bash
docker compose run --rm --entrypoint \
  "python3 /opt/backup/pg-backup-report.py once" pg-backup-report
```

**It does not attach the dump, and that is the point.** `pg_dumpall` writes
`CREATE ROLE ... PASSWORD` for every role in the cluster, so a dump in an inbox
is every database credential in an inbox, permanently and searchably. Since this
service exists it is also every abuse report, with each reporter's name, phone
number and address — mailed straight into the one inbox the whole design was
arranged to keep that material out of.

For an off-machine copy, push the dumps somewhere you control:

```bash
rclone copy ./backups remote:outpost-backups --include 'pgcluster-*.sql.gz'
```

and check what arrived against the SHA-256 in the weekly note.

---

## Still to do, and it is in the dashboard rather than here

Reading a report back is not offered: there is no GET on either path, so today
the only way to what arrived is the notification mail and `psql`. The dashboard —
the BFF, the categories, marking a report FILED or CLOSED, the confirmation to
the reporter and the deletion that follows it — is the next slice, and none of it
is built. Until it is, `status` on both tables stays `NEW` and deleting a handled
report is a `DELETE` typed by hand.
