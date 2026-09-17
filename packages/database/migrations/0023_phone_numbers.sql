-- Phone numbers, reduced to one form (PW-01).
--
-- A WhatsApp message arrives carrying `971501234567`. The person who sent it
-- is in `client_contacts` as `050 123 4567`, because that is how their
-- accountant wrote it down. Those are the same phone and no index can match
-- them, which is why the reduced form is stored beside the original and
-- indexed.
--
-- The rule is implemented twice: here, so a generated column can be indexed,
-- and in `packages/kernel/src/phone-number.ts`, so an inbound number can be
-- reduced before it is looked up. Two implementations of one rule drift.
-- `packages/database/src/phone-agreement.test.ts` runs several hundred inputs
-- through both and fails if they ever disagree — change one of them and that
-- test tells you about the other.
--
-- NOTE FOR WHOEVER CHANGES `e164`: Postgres does not recompute a stored
-- generated column when the function behind it changes. A change to this rule
-- needs a migration that rewrites the columns as well, or half the contacts
-- keep yesterday's answer and nobody notices until a message goes unmatched.

/*
 * Whether these digits are a UAE number with the trunk zero already removed.
 *
 * The parameter is not called `national`: that is a reserved word in Postgres,
 * which expects `NATIONAL CHARACTER` after it and reports the syntax error
 * against the word following it instead.
 *
 * The prefixes are checked rather than the length alone, because a Dubai
 * landline and a mobile are different lengths and accepting either length for
 * either kind would let two different people reduce to the same number.
 */
CREATE FUNCTION is_national_ae(local_number text) RETURNS boolean
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN left(local_number, 2) IN ('50', '52', '54', '55', '56', '58') THEN length(local_number) = 9
    WHEN left(local_number, 1) IN ('2', '3', '4', '6', '7', '9')       THEN length(local_number) = 8
    ELSE false
  END;
$$;

COMMENT ON FUNCTION is_national_ae(text) IS
  'A UAE number without its trunk zero. Mobiles are nine digits, landlines eight.';

/*
 * Reduces a number to E.164, or NULL when it cannot be read.
 *
 * NULL rather than a guess: a number this cannot parse belongs to nobody, and
 * attaching an inbound message to the wrong client is worse than attaching it
 * to none.
 */
CREATE FUNCTION e164(raw text) RETURNS text
  LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
AS $$
DECLARE
  latinised text;
  had_plus  boolean;
  digits    text;
  local_number text;
BEGIN
  -- Arabic-Indic and Persian digits, which is how a number written on an
  -- Arabic keyboard arrives. Without this the whole string looks like
  -- punctuation and reduces to nothing.
  latinised := translate(
    raw,
    '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
    '01234567890123456789'
  );

  had_plus := left(ltrim(latinised), 1) = '+';
  digits   := regexp_replace(latinised, '[^0-9]', '', 'g');
  IF digits = '' THEN
    RETURN NULL;
  END IF;

  -- 00 is how the rest of the world writes +. Both mean "international next".
  IF NOT had_plus AND left(digits, 2) = '00' THEN
    digits := substr(digits, 3);
  ELSIF NOT had_plus AND left(digits, 3) <> '971' THEN
    -- No international marker at all, so it is a local number: either with the
    -- trunk zero, 050..., or written bare the way it appears on a card.
    local_number := CASE WHEN left(digits, 1) = '0' THEN substr(digits, 2) ELSE digits END;
    RETURN CASE WHEN is_national_ae(local_number) THEN '+971' || local_number END;
  END IF;

  -- A UAE number is held to the national rules however it was marked. The plus
  -- says something about the format, not that the digits after it are real.
  IF left(digits, 3) = '971' THEN
    local_number := substr(digits, 4);
    RETURN CASE WHEN is_national_ae(local_number) THEN '+971' || local_number END;
  END IF;

  RETURN CASE WHEN length(digits) BETWEEN 8 AND 15 THEN '+' || digits END;
END;
$$;

COMMENT ON FUNCTION e164(text) IS
  'A phone number reduced to E.164, or NULL. Mirrored by toE164 in @amc/kernel.';

/*
 * The reduced form, generated rather than written.
 *
 * Generated because an application that maintains it will one day write a row
 * that skips it — a seed, a fix applied by hand, an import — and the contact
 * that results is invisible to every inbound message forever, silently.
 */
ALTER TABLE client_contacts
  ADD COLUMN phone_e164 text GENERATED ALWAYS AS (e164(phone)) STORED;

ALTER TABLE leads
  ADD COLUMN phone_e164 text GENERATED ALWAYS AS (e164(phone)) STORED;

-- The question these answer: whose number is this? Asked once per inbound
-- message, so it is worth an index.
CREATE INDEX client_contacts_phone_e164_idx ON client_contacts (phone_e164)
  WHERE phone_e164 IS NOT NULL;

CREATE INDEX leads_phone_e164_idx ON leads (phone_e164)
  WHERE phone_e164 IS NOT NULL;

COMMENT ON COLUMN client_contacts.phone_e164 IS
  'phone reduced to E.164. Generated: never write this column.';
COMMENT ON COLUMN leads.phone_e164 IS
  'phone reduced to E.164. Generated: never write this column.';
