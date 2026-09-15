-- Background jobs (ADR-0006).
--
-- The queue is a table so that enqueueing can join the transaction that caused
-- it: a change either commits with its job or does not happen at all.

CREATE TABLE jobs (
  id            text        PRIMARY KEY,
  name          text        NOT NULL,
  payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- When this becomes eligible. Delay is how escalations at 7 and 14 days are
  -- expressed, without anything having to stay awake in between.
  run_at        timestamptz NOT NULL DEFAULT now(),
  priority      integer     NOT NULL DEFAULT 0,

  attempts      integer     NOT NULL DEFAULT 0,
  max_attempts  integer     NOT NULL DEFAULT 5,

  -- A claim is a lease. A worker that dies mid-job releases its work when the
  -- lease lapses, rather than holding it for ever.
  claimed_at    timestamptz,
  claimed_by    text,
  lease_until   timestamptz,

  completed_at  timestamptz,
  failed_at     timestamptz,
  last_error    text,

  -- Natural key for work that must happen once per thing per period: the VAT
  -- return task for one client and one quarter, and no second copy however
  -- many times the scheduler runs.
  unique_key    text,

  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT jobs_attempts_sane     CHECK (attempts >= 0 AND max_attempts > 0),
  CONSTRAINT jobs_name_present      CHECK (length(btrim(name)) > 0),
  CONSTRAINT jobs_claim_is_complete CHECK (
    (claimed_at IS NULL AND claimed_by IS NULL AND lease_until IS NULL)
    OR (claimed_at IS NOT NULL AND claimed_by IS NOT NULL AND lease_until IS NOT NULL)
  ),
  CONSTRAINT jobs_not_both_outcomes CHECK (completed_at IS NULL OR failed_at IS NULL)
);

-- The only hot query: what is runnable now, best first. Partial, so the index
-- stays small however much history the table accumulates.
CREATE INDEX jobs_runnable_idx
  ON jobs (priority DESC, run_at)
  WHERE completed_at IS NULL AND failed_at IS NULL;

-- Reaping stale leases.
CREATE INDEX jobs_lease_idx
  ON jobs (lease_until)
  WHERE completed_at IS NULL AND failed_at IS NULL AND claimed_at IS NOT NULL;

-- One live job per natural key. Completed and failed rows are excluded, so the
-- same key can be used again next period.
CREATE UNIQUE INDEX jobs_unique_key_idx
  ON jobs (unique_key)
  WHERE unique_key IS NOT NULL AND completed_at IS NULL AND failed_at IS NULL;

COMMENT ON TABLE jobs IS
  'Background work, claimed with FOR UPDATE SKIP LOCKED. See docs/adr/0006-postgres-job-queue.md';
