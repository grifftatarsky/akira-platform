# microgpt-comms — putting it on the server

Abuse intake for outpostmessaging.com. A form posts a report, the service verifies
it is actually an Outpost report, stores it, and mails `abuse@outpostmessaging.com`.

Port **7088**, nginx prefix **`/cms`**, database **`cms-db`**.

---

## 1. Make the database

`init-db.sh` only runs the first time Postgres initialises an empty volume, and
yours is not empty — so the `CMS` block added to that script is for a future
rebuild, and today the same thing is done by hand.

Run this on the server. Pick a real password first and use the same one in step 2.

```bash
docker exec -i pgsql psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<'SQL'
CREATE DATABASE "cms-db";
CREATE ROLE "cms_user" LOGIN PASSWORD 'PUT_A_REAL_PASSWORD_HERE';
ALTER DATABASE "cms-db" OWNER TO "cms_user";
GRANT ALL PRIVILEGES ON DATABASE "cms-db" TO "cms_user";
SQL
```

Then the schema ownership, so Liquibase can create tables when the service boots:

```bash
docker exec -i pgsql psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" -d "cms-db" <<'SQL'
ALTER SCHEMA public OWNER TO "cms_user";
GRANT USAGE, CREATE ON SCHEMA public TO "cms_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO "cms_user";
GRANT USAGE,  SELECT, UPDATE          ON ALL SEQUENCES IN SCHEMA public TO "cms_user";
SQL
```

Check it took:

```bash
docker exec -i pgsql psql --username "$POSTGRES_USER" -c '\l' | grep cms-db
```

Liquibase creates `abuse_report` and its two indexes on first boot. Nothing else
to run.

---

## 2. Environment

Add to `.env`. **Everything marked FILL IN has no working default** — the service
starts without them and stores reports, but no mail goes out and `notified_at`
stays null on every row.

```bash
# ---- Database (step 1) ----
CMS_DATASOURCE_URL=jdbc:postgresql://pgsql:5432/cms-db
CMS_DATASOURCE_NAME=cms-db
CMS_DATASOURCE_USERNAME=cms_user
CMS_DATASOURCE_PASSWORD=          # FILL IN — the password from step 1

# ---- Where a report goes ----
CMS_REPORT_TO=abuse@outpostmessaging.com
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

# ---- Who may post the form ----
CMS_ALLOWED_ORIGINS=https://outpostmessaging.com

# ---- Wiring ----
PORT_CMS=7088
PREFIX_CMS=/cms
```

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
# Abuse intake. The form on outpostmessaging.com posts here.
location /cms/ {
    rewrite ^/cms/(.*) /$1 break;
    proxy_pass http://host.docker.internal:7088/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

The upload cap is 256 KB, well under nginx's own 1 MB default, so
`client_max_body_size` needs nothing. That is deliberate: a report is about a
kilobyte, and the small cap is the first thing a misdirected photo hits.

---

## 4. Build and run

```bash
JAVA_HOME=$(/usr/libexec/java_home -v 26) ./mvnw -B -ntp -pl microgpt-comms -am verify
docker build -f DockerfileComms -t microgpt-comms .
```

Or run the jar directly, as the other services do locally.

Check it came up, and that Liquibase ran:

```bash
curl -s localhost:7088/actuator/health/readiness
docker exec -i pgsql psql --username "$POSTGRES_USER" -d cms-db -c '\dt'
```

---

## 5. Prove the refusal before you trust it

The one behaviour that matters is that an image cannot get in. Test it against
the running service rather than taking the unit tests' word:

```bash
# Should be refused with 422 and a sentence.
curl -i -F report=@/path/to/any.jpg -F description=test -F email=you@example.com \
  http://localhost:7088/reports

# Should be refused with 400 — no way to reach the reporter.
curl -i -F report=@report.txt -F description=test http://localhost:7088/reports
```

---

## Still to do, and it is in the app rather than here

The app's report is written into a mail composer (`AbuseReport.mailURL`), so a
member can read it and send it — but there is no way to **save it as a file**, and
this form asks for a file. Until the app grows a share sheet on that screen, a
reporter has to copy the text into a note and attach that, which works and is
clumsy. That is one affordance on the report screen, not a protocol change.
