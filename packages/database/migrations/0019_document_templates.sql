-- Letters the practice sends (FR-15).
--
-- An engagement letter, an authorisation to act on EmaraTax, a request to
-- deregister. Each is the same words every time with the client's details
-- dropped in, and each is currently a Word file somebody copies and edits by
-- hand — which is how a letter goes out with the previous client's name in it.
--
-- Stored rather than compiled in, so the firm can change its own wording
-- without a deployment. The placeholders are a closed set the code knows
-- about; anything else in the body is left alone rather than guessed at.

CREATE TABLE document_templates (
  id          text        PRIMARY KEY,
  -- What kind of letter. Stable, because the code refers to these.
  code        text        NOT NULL UNIQUE,
  name_en     text        NOT NULL,
  name_ar     text        NOT NULL,

  -- The letter itself, in both languages, with {{placeholders}}.
  body_en     text        NOT NULL,
  body_ar     text        NOT NULL,

  -- Retired rather than deleted: a letter sent last year was produced from
  -- the wording of last year, and the record of that should survive.
  retired_at  timestamptz,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT document_templates_named CHECK (
    length(btrim(name_en)) > 0 AND length(btrim(name_ar)) > 0
  ),
  CONSTRAINT document_templates_bodies_present CHECK (
    length(btrim(body_en)) > 0 AND length(btrim(body_ar)) > 0
  )
);

CREATE INDEX document_templates_live_idx ON document_templates (code) WHERE retired_at IS NULL;

CREATE TRIGGER document_templates_updated_at BEFORE UPDATE ON document_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/*
 * What was actually produced, and from which wording.
 *
 * The rendered text is kept rather than regenerated on demand. A letter is a
 * thing that was sent: reproducing it next year from today's template and
 * today's client record would produce a different letter and call it the same
 * one.
 */
CREATE TABLE generated_documents (
  id           text        PRIMARY KEY,
  client_id    text        NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  template_id  text        NOT NULL REFERENCES document_templates (id) ON DELETE RESTRICT,
  task_id      text        REFERENCES tasks (id) ON DELETE SET NULL,

  language     text        NOT NULL,
  title        text        NOT NULL,
  body         text        NOT NULL,

  generated_by text        REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT generated_documents_language_known CHECK (language IN ('en', 'ar')),
  CONSTRAINT generated_documents_body_present CHECK (length(btrim(body)) > 0)
);

CREATE INDEX generated_documents_client_idx ON generated_documents (client_id, created_at DESC);

COMMENT ON TABLE generated_documents IS
  'The letter as it went out. Kept rather than regenerated, because a letter is a thing that was sent.';
