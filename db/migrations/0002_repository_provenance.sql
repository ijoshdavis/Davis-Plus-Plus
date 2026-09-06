-- M3 prep: repository was missing the (system, tree_id, external_xref)
-- provenance columns that source/persona/family_persona all have, so a
-- repository's original @R...@ xref couldn't be recovered on export.

alter table repository add column system text;
alter table repository add column tree_id text;
alter table repository add column external_xref text;

-- backfilled by re-running ingest; only enforce uniqueness once populated
create unique index repository_system_tree_xref_key
    on repository (system, tree_id, external_xref);
