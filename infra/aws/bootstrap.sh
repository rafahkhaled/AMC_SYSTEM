#!/usr/bin/env bash
#
# Prepares a fresh Ubuntu 24.04 instance in me-central-1 to run the system.
#
#   # from your laptop, inside the repository:
#   scp -i ~/.ssh/amc.pem infra/aws/bootstrap.sh ubuntu@<instance>:~/
#   ssh -i ~/.ssh/amc.pem ubuntu@<instance>
#   less bootstrap.sh          # read it before running it
#   bash bootstrap.sh
#
# Copied up rather than fetched, because the repository is private: there is no
# URL this script could curl itself from before it has arranged the access it
# needs to clone.
#
# Safe to run twice. Every step checks whether it has already been done, so a
# half-finished run can simply be repeated rather than unpicked.
#
# It installs Docker, clones the repository, and starts the stack. It does not
# create anything on AWS and it does not invent secrets: if .env.production is
# missing it writes the example, explains what to fill in, and stops.

set -euo pipefail

REPO="${AMC_REPO:-git@gitlab.com:rafahkhaled7118/amc-system.git}"
BRANCH="${AMC_BRANCH:-main}"
DIRECTORY="${AMC_DIRECTORY:-/opt/amc}"
COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file .env.production"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[31mStopped: %s\033[0m\n' "$1" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || die "run this as the ubuntu user, not as root. It uses sudo where it needs to."
command -v sudo > /dev/null || die "sudo is not installed"
command -v apt-get > /dev/null || die "this script expects Ubuntu. On Amazon Linux the package steps differ."

# ---------------------------------------------------------------- packages --
say "Installing packages"
sudo apt-get update -qq
sudo apt-get install -y -qq ca-certificates curl gnupg git ufw unzip

if ! command -v docker > /dev/null; then
  # Docker's own repository. Ubuntu's docker.io package lags far enough behind
  # that `docker compose` as a subcommand may not exist at all.
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
fi

sudo systemctl enable --now docker
# So the stack comes back after a reboot without anybody logging in.
sudo usermod -aG docker "$USER"

# pg_dump for the nightly backup, and the AWS CLI to upload it. Both run on the
# host rather than in a container, which is why Postgres is published on
# loopback in the compose file.
if ! command -v pg_dump > /dev/null; then
  sudo apt-get install -y -qq postgresql-client-16 || sudo apt-get install -y -qq postgresql-client
fi
if ! command -v aws > /dev/null; then
  ARCHITECTURE="$(uname -m)"
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${ARCHITECTURE}.zip" -o /tmp/awscli.zip
  unzip -q -o /tmp/awscli.zip -d /tmp
  sudo /tmp/aws/install --update
  rm -rf /tmp/awscli.zip /tmp/aws
fi

# -------------------------------------------------------------------- swap --
say "Swap"
#
# A t3.small has two gigabytes, and the image build does not fit in it: the
# first build ever attempted was killed by the OOM killer partway through
# compiling the workspace. The Dockerfile now limits how much it builds at
# once, and this is the second half of that fix — headroom for the peak
# rather than a hard wall at it.
#
# Two gigabytes of swap on a gp3 volume costs about sixteen fils a month.
if ! swapon --show | grep -q .; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile > /dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
  # Swap is here for the build's peak, not to page the running system out.
  sudo sysctl -q vm.swappiness=10
  grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf > /dev/null
fi
swapon --show | sed 's/^/    /'

# ---------------------------------------------------------------- firewall --
say "Firewall"
# The security group is the real boundary; this is the second one, in case a
# rule there is ever widened by accident.
sudo ufw allow 22/tcp  > /dev/null
sudo ufw allow 80/tcp  > /dev/null
sudo ufw allow 443/tcp > /dev/null
sudo ufw --force enable > /dev/null
sudo ufw status | sed 's/^/    /'

# ------------------------------------------------------------- repository access --
say "Repository access"
#
# The repository is private, so the instance needs its own read-only way in.
# A deploy key rather than a token: the private half is generated here and
# never leaves this machine, there is nothing to paste into a script or a
# shell history, and revoking it is one click that affects nothing else.
if [ ! -f "$HOME/.ssh/id_ed25519" ]; then
  ssh-keygen -t ed25519 -N '' -C "amc-deploy-$(hostname)" -f "$HOME/.ssh/id_ed25519" > /dev/null
  echo "    generated a new key for this instance"
fi
ssh-keyscan -t rsa,ecdsa,ed25519 gitlab.com 2>/dev/null | sort -u >> "$HOME/.ssh/known_hosts"
sort -u -o "$HOME/.ssh/known_hosts" "$HOME/.ssh/known_hosts"

if ! ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes git@gitlab.com 2>&1 | grep -qi "welcome\|successfully"; then
  cat <<NOTE

    This instance cannot read the repository yet.

    Add the public key below to GitLab as a *deploy key*, with read-only
    access — Project → Settings → Repository → Deploy keys → Add key:

NOTE
  echo "    $(cat "$HOME/.ssh/id_ed25519.pub")"
  cat <<'NOTE'

    Read-only. This instance never pushes, and a deploy key that can write is
    a server that can rewrite the history it deploys from.

    Then run this script again.

NOTE
  die "add the deploy key first"
fi
echo "    gitlab.com accepts this instance's key"

# ------------------------------------------------------------------ source --
say "Source at ${DIRECTORY}"
if [ ! -d "${DIRECTORY}/.git" ]; then
  sudo mkdir -p "$DIRECTORY"
  sudo chown "$USER:$USER" "$DIRECTORY"
  git clone --branch "$BRANCH" "$REPO" "$DIRECTORY"
else
  git -C "$DIRECTORY" fetch --quiet origin "$BRANCH"
  git -C "$DIRECTORY" checkout --quiet "$BRANCH"
  git -C "$DIRECTORY" reset --hard --quiet "origin/${BRANCH}"
fi
cd "$DIRECTORY"
echo "    at $(git rev-parse --short HEAD)"

# --------------------------------------------------------------- the secrets --
if [ ! -f .env.production ]; then
  cp .env.production.example .env.production
  chmod 600 .env.production
  cat <<'NOTE'

    .env.production has been written from the example and nothing is filled in.

    Generate the three secrets:

      openssl rand -base64 32    # SECRET_ENCRYPTION_KEY
      openssl rand -base64 24    # POSTGRES_PASSWORD
      openssl rand -base64 32    # BACKUP_PASSPHRASE

    Keep the backup passphrase somewhere other than this server. A backup you
    cannot decrypt is not a backup, and this instance is what it protects
    against.

    Then set SITE_ADDRESS, ACME_EMAIL and STORAGE_BUCKET, and run this script
    again.

NOTE
  die "fill in .env.production first"
fi
chmod 600 .env.production

for required in SECRET_ENCRYPTION_KEY POSTGRES_PASSWORD SITE_ADDRESS ACME_EMAIL STORAGE_BUCKET; do
  value="$(grep -E "^${required}=" .env.production | cut -d= -f2-)"
  [ -n "$value" ] || die "${required} is empty in .env.production"
done

# ------------------------------------------------------------------- deploy --
say "Building and starting"
# sg docker, because the group membership added above does not apply to this
# shell until the next login.
sg docker -c "${COMPOSE} up -d --build"

say "What is running"
sg docker -c "${COMPOSE} ps"

# ------------------------------------------------------------------ backups --
say "Nightly backup"
SITE="$(grep -E '^SITE_ADDRESS=' .env.production | cut -d= -f2-)"
sudo tee /etc/cron.d/amc-backup > /dev/null <<CRON
# Nightly encrypted dump, uploaded and read back before it is trusted.
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
30 22 * * * ${USER} cd ${DIRECTORY} && set -a && . ./.env.production && set +a && DATABASE_URL="postgres://amc:\${POSTGRES_PASSWORD}@127.0.0.1:5432/amc" ./infra/backup/backup.sh /var/backups/amc >> /var/log/amc-backup.log 2>&1
CRON
sudo mkdir -p /var/backups/amc
sudo chown "$USER:$USER" /var/backups/amc
sudo touch /var/log/amc-backup.log
sudo chown "$USER:$USER" /var/log/amc-backup.log
echo "    22:30 UTC, which is 02:30 in Dubai"

cat <<NEXT

Done. Next:

  1. Point ${SITE} at this instance's Elastic IP, if you have not already.
     Caddy cannot get a certificate until the DNS record resolves here.

  2. Watch it get one:
       cd ${DIRECTORY} && ${COMPOSE} logs -f caddy

  3. Create the first user, since the screen that creates users is behind the
     sign-in that needs one:
       ${COMPOSE} exec -e AMC_PASSWORD='a long passphrase' \\
         api node apps/api/dist/cli/create-user.js you@yourfirm.ae "Your Name" manager

  4. Work through the first-deploy checklist in docs/deployment.md. It lists
     the things this machine could never prove and this server can — S3, KMS,
     SES, the backup restore, and the audit log refusing an update.

  Log out and back in before running docker without sg, so your group
  membership applies.

NEXT
