-- M6: the dashboard's stats row needs to count source/citation/repository,
-- which were never granted to `authenticated` at all (not an RLS decision -
-- see migration 0004's comment on why they're unrestricted - just that
-- nothing queried them from the client yet). Bibliographic metadata, not
-- personally sensitive, so a plain grant is enough; no RLS needed here.
grant select on source, citation, repository, person_external_id to authenticated;
