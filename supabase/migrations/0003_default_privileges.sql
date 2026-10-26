-- Default privileges for objects created later in schema public.
--
-- Supabase ships default ACLs that grant ALL on future tables, sequences and
-- functions in public to anon and authenticated. 0002 revokes them object by
-- object; this migration removes the defaults themselves so a table or
-- function added in a later migration starts closed. Each new object must
-- then grant explicitly what it needs (and enable RLS).
-- service_role keeps its default grants (the API uses it).

-- Objects created by postgres (the role migrations run as).
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

-- PostgreSQL itself grants EXECUTE on every new function to PUBLIC (which
-- anon and authenticated inherit). A per-schema rule cannot remove a global
-- default, so this one is global for functions created by postgres.
alter default privileges for role postgres
  revoke execute on functions from public;

-- Objects created by supabase_admin: only possible when the migration role
-- may alter that role's defaults (it may not on the local stack nor on hosted
-- Supabase, where postgres is not a member of supabase_admin). Our objects are
-- all owned by postgres; the catalog test asserts that supabase_admin owns
-- nothing in public.
do $$
begin
  if pg_has_role(current_user, 'supabase_admin', 'MEMBER') then
    alter default privileges for role supabase_admin in schema public
      revoke all on tables from anon, authenticated;
    alter default privileges for role supabase_admin in schema public
      revoke all on sequences from anon, authenticated;
    alter default privileges for role supabase_admin in schema public
      revoke all on functions from anon, authenticated;
  else
    raise notice 'skipping supabase_admin default privileges: % is not a member', current_user;
  end if;
end
$$;
