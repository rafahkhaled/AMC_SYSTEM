# This machine

No Docker, no Homebrew, no admin password. Everything lives under `~/.local`
and removing that directory undoes all of it.

| Tool | Where | Notes |
|---|---|---|
| Node 22 | `~/.local/opt/node` | pnpm 10 via corepack |
| Postgres 17 | `~/.local/opt/postgres` | Binaries from the Postgres.app image |
| GitHub CLI | `~/.local/opt/gh` | Authenticated, but see below |
| GitLab CLI | `~/.local/opt/glab` | The primary remote |

`~/.zshrc` exports the path. A fresh shell needs it; a Bash tool call should
export it explicitly.

## Postgres

Port **5433**, trust auth, role `amc`, databases `amc` and `amc_test`. It does
not start at login.

```bash
./scripts/pg.sh start     # or stop, status, log
```

## Running things

```bash
./scripts/dev.sh          # Postgres, migrations, API, worker, web
./scripts/demo.sh         # drives the whole auth path and prints it
pnpm verify               # lint, typecheck, tests, dependency rules
```

Integration tests need `TEST_DATABASE_URL=postgres://amc@127.0.0.1:5433/amc_test`.

## Hosting

**GitLab is the primary remote**, private. GitHub refuses to create
repositories for this account under US trade controls, and refuses to make an
existing one private; the public mirror at `rafahkhaled/AMC_SYSTEM` exists
because the owner asked for it after being told what it exposes.

`./scripts/mirror-push.sh` pushes to every remote and exits non-zero if any
failed.

## What cannot be verified here

- **Docker**, so the production image and compose file have never been built.
- **S3**, so `S3FileStorage` is tested only against our own usage of the API.
  MinIO no longer publishes public binaries and there is no Java for the
  alternatives.
- **KMS**, same.

All three are on the first-deploy checklist in `docs/deployment.md`.
