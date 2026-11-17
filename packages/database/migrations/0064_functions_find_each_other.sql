-- Every function of ours names where to look for what it calls.
--
-- A backup is restored with an empty search_path, the way pg_dump writes it,
-- and then e164() could not find is_national_ae() while the client contacts
-- were loading: the restore stopped there, so no backup could have been
-- brought back. Pinning the path on each function makes it independent of
-- whoever calls it, restore included.
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
     WHERE n.nspname = 'public'
       AND p.prokind IN ('f', 'p')
       AND d.objid IS NULL          -- not part of an extension
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_catalog', fn.signature);
  END LOOP;
END $$;
