-- The one table 0021 missed.
--
-- A separate migration rather than an edit to that one. The migrator refuses a
-- migration whose contents have changed since it ran, which is the right
-- refusal: a file that has already been applied somewhere is a record of what
-- happened, not a draft. It caught this within a minute of the edit.

COMMENT ON TABLE client_credentials IS
  'Client logins to government portals. There is deliberately no plaintext column: reading one goes through the vault, which writes the audit row before it returns anything.';
