-- M2 — Schema + identity spine (see docs/build-plan.md §5, §6 M2)
--
-- Scope: identity spine + evidence layer + personas only. No conclusion layer
-- yet (person_name, event, family, relationship, conflict) — that is M4+.
-- Local ids are the only primary keys; every external id is an attribute
-- (docs/build-plan.md §1.5).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create table person (
    id         uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now()
);

create table person_external_id (
    id         uuid primary key default gen_random_uuid(),
    person_id  uuid not null references person(id) on delete cascade,
    system     text not null,        -- 'ancestry_pid' | 'legacy_xref' | 'fs_id' | ...
    value      text not null,        -- the raw external id/xref, verbatim
    tree_id    text,                 -- e.g. Ancestry tree name/RIN; null where not applicable
    first_seen timestamptz not null default now(),
    last_seen  timestamptz not null default now(),
    unique (system, value, tree_id)
);

-- ---------------------------------------------------------------------------
-- Evidence layer (source -> citation; Gramps-style repository/source/citation
-- split per docs/build-plan.md §3 "Reference, do not vendor" / Gramps)
-- ---------------------------------------------------------------------------

create table repository (
    id   uuid primary key default gen_random_uuid(),
    name text not null,
    addr text
);

create table source (
    id            uuid primary key default gen_random_uuid(),
    repository_id uuid references repository(id),
    system        text not null,     -- ingest adapter that produced this row, e.g. 'ancestry_gedcom'
    tree_id       text,
    external_xref text not null,     -- the @S...@ pointer from the source file
    title         text,
    author        text,
    publ          text,
    publ_date     text,
    publ_place    text,
    apid_db_id    text,              -- '1,<dbId>' portion when the source-level _APID has a record id of 0
    created_at    timestamptz not null default now(),
    unique (system, tree_id, external_xref)
);

create table citation (
    id             uuid primary key default gen_random_uuid(),
    source_id      uuid not null references source(id) on delete cascade,
    page           text,
    data_www       text,
    apid_db_id     text,
    apid_record_id text,
    raw_apid       text,             -- full '1,<dbId>::<recordId>' exactly as encountered
    created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Personas: what each source says, kept separate from what we conclude
-- (docs/build-plan.md §1.2). One row per individual/family per source file.
-- ---------------------------------------------------------------------------

create table persona (
    id            uuid primary key default gen_random_uuid(),
    person_id     uuid not null references person(id) on delete cascade,
    system        text not null,     -- 'ancestry_gedcom', etc.
    tree_id       text,
    external_xref text not null,     -- the @I...@ pointer from the source file
    sex           text,
    raw           jsonb not null,    -- full structure_to_dict() snapshot as asserted by the source
    imported_at   timestamptz not null default now(),
    unique (system, tree_id, external_xref)
);

create table persona_citation (
    persona_id  uuid not null references persona(id) on delete cascade,
    citation_id uuid not null references citation(id) on delete cascade,
    field_path  text not null default '',  -- e.g. 'NAME', 'BIRT' — where in the persona this citation supports
    primary key (persona_id, citation_id, field_path)
);

-- Family personas: kept alongside individual personas for fidelity (marriage
-- citations, husb/wife/child linkage as asserted) even though family/
-- relationship conclusion tables don't exist yet.

create table family_persona (
    id            uuid primary key default gen_random_uuid(),
    system        text not null,
    tree_id       text,
    external_xref text not null,     -- the @F...@ pointer from the source file
    husb_xref     text,
    wife_xref     text,
    chil_xrefs    text[] not null default '{}',
    raw           jsonb not null,
    imported_at   timestamptz not null default now(),
    unique (system, tree_id, external_xref)
);

create table family_persona_citation (
    family_persona_id uuid not null references family_persona(id) on delete cascade,
    citation_id        uuid not null references citation(id) on delete cascade,
    field_path         text not null default '',
    primary key (family_persona_id, citation_id, field_path)
);

create index on person_external_id (person_id);
create index on persona (person_id);
create index on persona_citation (citation_id);
create index on family_persona_citation (citation_id);
create index on citation (source_id);
