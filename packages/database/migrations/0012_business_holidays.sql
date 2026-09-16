-- The days the authority is closed.
--
-- A table rather than a rule in code, because most UAE holidays follow the
-- lunar calendar and are announced by the government each year. Code that
-- computed Eid would be wrong most years; a table somebody updates each
-- December is right every year.
--
-- The weekend is not here: Saturday and Sunday since January 2022, which is a
-- rule rather than data.

CREATE TABLE business_holidays (
  observed_on date        PRIMARY KEY,
  name_en     text        NOT NULL,
  name_ar     text        NOT NULL,
  -- Lunar dates are confirmed close to the day, so a provisional entry can be
  -- distinguished from one the government has announced.
  confirmed   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT business_holidays_named CHECK (
    length(btrim(name_en)) > 0 AND length(btrim(name_ar)) > 0
  )
);

CREATE INDEX business_holidays_year_idx ON business_holidays (observed_on);

-- The fixed dates, which do not move. The lunar ones are added each year once
-- announced, and are deliberately absent rather than guessed at.
INSERT INTO business_holidays (observed_on, name_en, name_ar, confirmed) VALUES
  ('2026-01-01', 'New Year''s Day',   'رأس السنة الميلادية', true),
  ('2026-12-01', 'Commemoration Day', 'يوم الشهيد',          true),
  ('2026-12-02', 'National Day',      'اليوم الوطني',        true),
  ('2026-12-03', 'National Day',      'اليوم الوطني',        true),
  ('2027-01-01', 'New Year''s Day',   'رأس السنة الميلادية', true),
  ('2027-12-01', 'Commemoration Day', 'يوم الشهيد',          true),
  ('2027-12-02', 'National Day',      'اليوم الوطني',        true),
  ('2027-12-03', 'National Day',      'اليوم الوطني',        true);

COMMENT ON TABLE business_holidays IS
  'Updated each year when the lunar holidays are announced. A missing year makes every deadline in it wrong.';
