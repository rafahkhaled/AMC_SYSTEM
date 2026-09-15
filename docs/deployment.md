# Deploying

One small instance in **me-central-1**, as ADR-0005 sets out. Postgres, the
API, the worker and Caddy, with no Redis because the queue is a table
(ADR-0006).

## Before the first deploy

Generate the two secrets. Neither has a default, and the application refuses to
start in production without the second, which is deliberate: a system that
falls back to a known key is worse than one that will not boot.

```bash
openssl rand -base64 32   # SECRET_ENCRYPTION_KEY
openssl rand -base64 24   # POSTGRES_PASSWORD
openssl rand -base64 32   # BACKUP_PASSPHRASE, kept somewhere other than the server
```

Put them in `.env.production` on the instance, readable only by the deploying
user. The backup passphrase must also live somewhere that survives the server,
because a backup you cannot decrypt is not a backup.

## Deploy

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d --build
```

Migrations run to completion before the API starts serving, so the system never
answers requests against a schema it was not built for.

Create the first user, since the only screen that creates users sits behind the
sign-in that needs one:

```bash
docker compose -f infra/docker-compose.prod.yml exec -e AMC_PASSWORD='a long passphrase' \
  api node apps/api/dist/cli/create-user.js wael@activemanagement.ae "Wael Ajam" manager
```

## Checklist for the first deploy

These are the things this machine could not prove and the server can. Work
through them once, and record the date.

- [ ] `https://<domain>/api/health/ready` reports the migration count
- [ ] Signing in sets a cookie carrying `Secure`, `HttpOnly` and `SameSite=Strict`
- [ ] **S3 actually works.** The adapter has never run against real S3; it is
      tested only against our own usage of the API. Upload a document, read it
      back, confirm the object is encrypted and the checksum matches
- [ ] **KMS actually works.** Seal and open a credential, and confirm the
      encryption context is enforced by trying a value from another context
- [ ] The audit log refuses updates when connected as the application role
- [ ] `infra/backup/verify-restore.sh` passes against the production database
- [ ] A backup lands in S3 and can be downloaded and decrypted from another machine
- [ ] Caddy has a certificate and the security headers are present
- [ ] The worker log shows it started and is draining the outbox

## Backups

```bash
DATABASE_URL=... BACKUP_PASSPHRASE=... ./infra/backup/backup.sh /var/backups/amc
```

Nightly, by cron or a systemd timer. With `S3_BACKUP_BUCKET` set it uploads and
reads the file back to compare before reporting success, because an upload that
says it worked and stored nothing is the failure worth catching.

Restoring is deliberately explicit about where it is going. A restore script
that guesses its target is a script that one day overwrites production because
somebody omitted an argument:

```bash
BACKUP_PASSPHRASE=... ./infra/backup/restore.sh <file> <target database url>
```

`verify-restore.sh` does the whole cycle against a throwaway database and
compares every table's row count, then checks the audit log still refuses
updates afterwards. It runs in the pipeline on every change to the default
branch, and should run monthly in production. A backup nobody has restored is a
hope rather than a backup (NFR-08).

## What is not here yet

Continuous write-ahead log archiving, which would narrow the recovery point
from a night to a few minutes. Nightly dumps are the right starting position
for a ten-person firm; this is the first thing to add when the volume of
recorded time makes losing a day's work expensive.
