/*
 * What a tax number box says when there is no number, in the firm's words.
 *
 * NA and Rejection were the two allowed; the firm also writes "De-Reg" and
 * the like. Anything that is not a fifteen-digit number is kept as written.
 */
ALTER TABLE clients
  DROP CONSTRAINT clients_vat_remark_known,
  DROP CONSTRAINT clients_ct_remark_known,
  ADD CONSTRAINT clients_vat_remark_short CHECK (vat_remark IS NULL OR length(vat_remark) BETWEEN 1 AND 60),
  ADD CONSTRAINT clients_ct_remark_short  CHECK (ct_remark  IS NULL OR length(ct_remark)  BETWEEN 1 AND 60);
