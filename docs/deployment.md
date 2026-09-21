# Deploying

One small instance in **me-central-1**, as ADR-0005 sets out. Postgres, the
API, the worker and Caddy, with no Redis because the queue is a table
(ADR-0006).

This document is in two halves: what you create on AWS once, and what runs on
the instance every deploy.

---

## Part one: AWS, once

Everything here is done from your own machine with the AWS CLI, signed in as a
user who can create IAM, EC2 and S3 resources. The console does the same job if
you prefer clicking; the names below are what the second half expects.

Set the region first. Every command assumes it.

```bash
export AWS_REGION=me-central-1
export AMC_BUCKET=amc-documents-<something-unique>   # bucket names are global
export AMC_DOMAIN=amc.yourfirm.ae
```

### 1. The bucket for documents

```bash
aws s3api create-bucket --bucket "$AMC_BUCKET" \
  --create-bucket-configuration LocationConstraint="$AWS_REGION"

# A client's trade licence is not public, and the default is not enough.
aws s3api put-public-access-block --bucket "$AMC_BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-encryption --bucket "$AMC_BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

# Documents version rather than overwrite in the application; versioning here
# is the second line, for the day somebody deletes an object by hand.
aws s3api put-bucket-versioning --bucket "$AMC_BUCKET" \
  --versioning-configuration Status=Enabled
```

A second bucket for backups, so a mistake in one cannot take both:

```bash
export AMC_BACKUP_BUCKET="${AMC_BUCKET}-backups"
aws s3api create-bucket --bucket "$AMC_BACKUP_BUCKET" \
  --create-bucket-configuration LocationConstraint="$AWS_REGION"
aws s3api put-public-access-block --bucket "$AMC_BACKUP_BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

### 2. A role for the instance, not a set of keys

The application never reads an access key. `new S3Client({ region })` has no
credentials in it, so the SDK walks its default chain and finds the instance's
own role. That is the point: there is no key on the disk to leak, and nothing
to rotate.

```bash
cat > /tmp/trust.json <<'JSON'
{ "Version": "2012-10-17", "Statement": [{
  "Effect": "Allow",
  "Principal": { "Service": "ec2.amazonaws.com" },
  "Action": "sts:AssumeRole"
}]}
JSON

aws iam create-role --role-name amc-instance \
  --assume-role-policy-document file:///tmp/trust.json

cat > /tmp/policy.json <<JSON
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
    "Resource": ["arn:aws:s3:::${AMC_BUCKET}/*", "arn:aws:s3:::${AMC_BACKUP_BUCKET}/*"] },
  { "Effect": "Allow",
    "Action": ["s3:ListBucket"],
    "Resource": ["arn:aws:s3:::${AMC_BUCKET}", "arn:aws:s3:::${AMC_BACKUP_BUCKET}"] },
  { "Effect": "Allow",
    "Action": ["ses:SendEmail", "ses:SendRawEmail"],
    "Resource": "*" }
]}
JSON

aws iam put-role-policy --role-name amc-instance \
  --policy-name amc-instance --policy-document file:///tmp/policy.json

aws iam create-instance-profile --instance-profile-name amc-instance
aws iam add-role-to-instance-profile \
  --instance-profile-name amc-instance --role-name amc-instance
```

### 3. The security group

```bash
VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' --output text)

SG=$(aws ec2 create-security-group --group-name amc \
  --description "AMC System" --vpc-id "$VPC" --query GroupId --output text)

# SSH from your address only. 0.0.0.0/0 here is how an instance is found by a
# scanner within the hour.
MY_IP=$(curl -fsS https://checkip.amazonaws.com)
aws ec2 authorize-security-group-ingress --group-id "$SG" \
  --protocol tcp --port 22 --cidr "${MY_IP}/32"

aws ec2 authorize-security-group-ingress --group-id "$SG" \
  --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id "$SG" \
  --protocol tcp --port 443 --cidr 0.0.0.0/0
```

Port 5432 is not opened and must not be. Postgres is published on the
instance's loopback so the nightly `pg_dump` can reach it, and nowhere else.

### 4. The instance

`t3.small` is two vCPUs and 2 GB, which is enough for ten users and leaves room
for the build. 30 GB of gp3 holds the image, the database and a few nights of
backups.

```bash
aws ec2 create-key-pair --key-name amc --query KeyMaterial --output text > ~/.ssh/amc.pem
chmod 600 ~/.ssh/amc.pem

AMI=$(aws ssm get-parameter \
  --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
  --query 'Parameter.Value' --output text)

INSTANCE=$(aws ec2 run-instances --image-id "$AMI" --instance-type t3.small \
  --key-name amc --security-group-ids "$SG" \
  --iam-instance-profile Name=amc-instance \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30,"VolumeType":"gp3","Encrypted":true}}]' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=amc}]' \
  --query 'Instances[0].InstanceId' --output text)

aws ec2 wait instance-running --instance-ids "$INSTANCE"
```

**Then the one step that is easy to miss and breaks S3 on the first upload:**

```bash
aws ec2 modify-instance-metadata-options --instance-id "$INSTANCE" \
  --http-tokens required --http-put-response-hop-limit 2
```

The instance role is fetched from the metadata service at 169.254.169.254. Its
default hop limit is 1, and a request from inside a Docker container crosses
the bridge and spends that hop before it arrives. The SDK then reports missing
credentials, from a container on an instance that plainly has a role, and the
cause is nowhere near the error. Two is the fix.

### 5. An address that survives a restart

```bash
ALLOCATION=$(aws ec2 allocate-address --domain vpc --query AllocationId --output text)
aws ec2 associate-address --instance-id "$INSTANCE" --allocation-id "$ALLOCATION"
aws ec2 describe-addresses --allocation-ids "$ALLOCATION" \
  --query 'Addresses[0].PublicIp' --output text
```

Point `$AMC_DOMAIN` at that address with an **A** record at your registrar, and
wait for it to resolve before going further. Caddy asks Let's Encrypt for a
certificate on its first start, and a name that does not yet resolve to this
instance means a failed challenge and a back-off.

```bash
dig +short "$AMC_DOMAIN"    # must print the Elastic IP
```

### 6. SES, if email is wanted

Email is optional and the system works without it — the worker writes
notification emails to the log when `NOTIFICATION_FROM` is empty.

```bash
aws sesv2 create-email-identity --email-identity noreply@yourfirm.ae
```

Verify the address from the email SES sends, then ask AWS to move the account
out of the sandbox. Until they do, SES will only deliver to addresses you have
verified, which is enough for testing and not for clients.

---

## Part two: the instance

```bash
ssh -i ~/.ssh/amc.pem ubuntu@"$AMC_DOMAIN"

curl -fsSL https://gitlab.com/rafahkhaled7118/amc-system/-/raw/main/infra/aws/bootstrap.sh -o bootstrap.sh
less bootstrap.sh          # read it before running it
bash bootstrap.sh
```

It installs Docker, clones the repository to `/opt/amc`, and stops the first
time to tell you to fill in `.env.production`. Generate the three secrets it
names, set `SITE_ADDRESS`, `ACME_EMAIL` and `STORAGE_BUCKET`, and run it again.

The backup passphrase must also live somewhere that survives the server,
because a backup you cannot decrypt is not a backup and this instance is the
thing it protects against.

The script is safe to run twice. Every later deploy is the same command.

### Later deploys

```bash
cd /opt/amc && bash infra/aws/bootstrap.sh
```

It fetches, rebuilds and restarts. Migrations run to completion before the API
serves anything, so the system never answers requests against a schema it was
not built for.

### The first user

The only screen that creates users sits behind the sign-in that needs one.

```bash
cd /opt/amc
docker compose -f infra/docker-compose.prod.yml --env-file .env.production \
  exec -e AMC_PASSWORD='a long passphrase' \
  api node apps/api/dist/cli/create-user.js wael@activemanagement.ae "Wael Ajam" manager
```

---

## Checklist for the first deploy

These are the things this machine could not prove and the server can. Work
through them once, and record the date.

- [ ] **The image builds at all.** No machine in this project has Docker, so
      nothing has ever built it. That is exactly how its dependency stage
      drifted six packages behind the workspace; `pnpm arch:check` now catches
      that particular drift, but the first real `docker compose build` is still
      the first time this Dockerfile has ever run
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
- [ ] **The instance role reaches S3 from inside a container.** If uploads fail
      with missing credentials, the metadata hop limit is still 1. See part one,
      step four — this is the single most likely first-deploy failure
- [ ] Once Meta is configured: `GET /api/whatsapp/webhook` echoes the challenge
      for the right verify token and answers 404 for a wrong one, and a POST
      with a bad signature is refused with 403

## Backups

```bash
DATABASE_URL=... BACKUP_PASSPHRASE=... ./infra/backup/backup.sh /var/backups/amc
```

`bootstrap.sh` installs this as a cron entry at 22:30 UTC, which is 02:30 in
Dubai. With `S3_BACKUP_BUCKET` set it uploads and reads the file back to
compare before reporting success, because an upload that says it worked and
stored nothing is the failure worth catching.

It runs on the host rather than in a container, which is why the compose file
publishes Postgres on `127.0.0.1:5432` — reachable from the instance and from
nowhere else.

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
