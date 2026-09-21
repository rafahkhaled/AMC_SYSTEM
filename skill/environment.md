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

Stop a stray API or web server by port, never by path:

```bash
lsof -ti tcp:3000 | xargs kill     # API
lsof -ti tcp:5173 | xargs kill     # web
```

The services are started from inside their own directories, so their command
lines read `node dist/main.js`. A `pkill -f "api/dist/main.js"` matches nothing
and says nothing, and the old build keeps answering. See `bugs.md`.

The demo account is `wael@activemanagement.ae`, and `scripts/demo.sh` holds the
password it seeds. It is a local fixture and exists in no other environment.

Vite listens on `localhost` only. `http://127.0.0.1:5173` is refused; use the
name.

## Hosting

**GitLab is the primary remote**, private. GitHub refuses to create
repositories for this account under US trade controls, and refuses to make an
existing one private; the public mirror at `rafahkhaled/AMC_SYSTEM` exists
because the owner asked for it after being told what it exposes.

`./scripts/mirror-push.sh` pushes to every remote and exits non-zero if any
failed.

## The acceptance run

```bash
node scripts/acceptance-p1.mjs        # against a running API on :3000
```

It walks the whole Phase 1 journey and prints what happened, check by check,
ending with what it could not check. It is not a test suite — the suites prove
the pieces — it proves they join up, and it is the thing to run before saying a
phase is done.

## What cannot be verified here

- **Docker**, so the production image and compose file cannot be built *here*.
  They have now been built and run once, on a disposable EC2 instance in
  us-east-1, which is the only reason any of it is known to work. That
  rehearsal found five failures in an afternoon — see `bugs.md`. Do the same
  before any change to the Dockerfile or the compose file is trusted: a
  throwaway instance costs about ten cents and is the only machine in this
  project that can tell you the truth about either file.
  This is not a small gap: the Dockerfile's dependency stage had drifted six
  workspace packages behind and `pnpm install --frozen-lockfile` would have
  failed in the image, naming the lockfile rather than the missing package.
  `scripts/dockerfile-manifests.mjs` runs in `arch:check` and catches that one
  kind of drift; everything else about the image is still unproven until the
  first `docker compose build` on the server.
- **S3**, so `S3FileStorage` is tested only against our own usage of the API.
  MinIO no longer publishes public binaries and there is no Java for the
  alternatives.
- **KMS**, same.
- **SES**, so notification email has never actually been sent. The path runs
  in full — the preference is read, the recipient looked up, the wording chosen
  in the right language — and only the last call differs: without
  `NOTIFICATION_FROM` the worker writes the email to the log instead. The SES
  adapter itself is unexercised.

All three are on the first-deploy checklist in `docs/deployment.md`.

- **Service worker registration.** The browser available here refuses to
  register one at all — "an unknown error occurred when fetching the script",
  with the script served correctly as `text/javascript` and reachable by
  `curl`. The manifest, the icons and the worker's own logic are all checked
  (`apps/web/src/pwa/service-worker.test.ts` runs the real file and proves it
  never answers for `/api`), but whether the application installs to a home
  screen has to be confirmed on a real phone. It belongs in the P1 acceptance
  run.

- **A WhatsApp Business account.** `WHATSAPP_DRIVER=log` is the default and
  runs the whole path — a message is read from the webhook, matched to a
  client, stored, answered, logged, queued, given an id and marked sent —
  writing the last step to the log instead of to a phone. Untested: Meta's
  Cloud API itself, the media fetch (which is two requests and a bearer token
  on a host that looks public), and template sending, which cannot be tried at
  all until Meta approves the templates. That is PW-09 and it is blocked on
  Meta, not on us.

  The signature check, the subscription handshake, duplicate deliveries and
  the whole bot are exercised for real against a running server. To do it
  again, sign a payload with the app secret:

  ```bash
  node -e 'const{createHmac}=require("node:crypto");const b=JSON.stringify(require("./payload.json"));console.log("sha256="+createHmac("sha256","devsecret").update(b).digest("hex"))'
  ```

  and post it to `/api/whatsapp/webhook` with that as `x-hub-signature-256`.
  A wrong signature must give 403; anything it accepted, including a payload
  it could not read, must give 200 — Meta retries anything else for a day and
  disables the webhook after enough failures.

- **Arabic rendering.** jsdom does not reorder bidirectional text, so no test
  in `apps/web` can see a mixed Arabic-and-Latin line laid out wrongly. Any
  screen that puts an identifier, a phone number, a TRN or an amount inside
  Arabic prose has to be opened in a browser in Arabic once. A static page
  that loads `apps/web/dist/assets/index-*.css` and holds the markup is enough
  and needs no sign-in.
