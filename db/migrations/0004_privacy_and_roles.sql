-- M5 — Auth, RLS, storage (see docs/build-plan.md §6 M5)
--
-- Scope of this migration: roles + computed living/deceased privacy +
-- RLS on the tables that actually expose a named, dated individual
-- (person, persona, family_persona) plus finding (curation data, not
-- public-facing - owner/family only, no viewer access at all).
--
-- Deliberately NOT RLS-restricted here: source/citation/repository
-- (bibliographic metadata - book titles, URLs, not personal data) and
-- person_external_id (a person_id + external xref/tree_id, meaningless
-- without the persona row it can't be joined to under RLS). Documented as
-- a scoping decision in docs/decisions.md, not an oversight.

create table app_user_role (
    user_id    uuid primary key references auth.users(id) on delete cascade,
    role       text not null check (role in ('owner', 'family', 'viewer')),
    created_at timestamptz not null default now()
);

-- Computed per §5: "no death date AND born < 100 years ago", with a manual
-- override column. Recomputed from persona data the same way findings are -
-- see core/privacy.py - not a generated column, since "born < 100 years ago"
-- needs today's date and death/birth years live inside persona.raw jsonb,
-- not a clean person-level column.
create table person_privacy (
    person_id           uuid primary key references person(id) on delete cascade,
    is_living           boolean not null default true,
    is_living_override  boolean,
    visibility_tier     text not null default 'family' check (visibility_tier in ('owner', 'family', 'viewer')),
    computed_at         timestamptz not null default now()
);

create or replace function current_user_role() returns text
language sql stable
as $$
    select role from app_user_role where user_id = auth.uid()
$$;

-- No privacy row yet, or no external-id match => conservatively "living"
-- (hidden from viewer). Durability/privacy outrank convenience here.
create or replace function is_person_living(p_person_id uuid) returns boolean
language sql stable
as $$
    select coalesce(
        (select coalesce(pp.is_living_override, pp.is_living)
         from person_privacy pp where pp.person_id = p_person_id),
        true
    )
$$;

create or replace function resolve_person_id(p_system text, p_tree_id text, p_xref text) returns uuid
language sql stable
as $$
    select person_id from person_external_id
    where system = p_system and tree_id = p_tree_id and value = p_xref
    limit 1
$$;

alter table person enable row level security;
alter table persona enable row level security;
alter table family_persona enable row level security;
alter table person_privacy enable row level security;
alter table finding enable row level security;

create policy person_select on person for select
using (
    current_user_role() in ('owner', 'family')
    or (current_user_role() = 'viewer' and not is_person_living(id))
);

create policy persona_select on persona for select
using (
    current_user_role() in ('owner', 'family')
    or (current_user_role() = 'viewer' and not is_person_living(person_id))
);

create policy family_persona_select on family_persona for select
using (
    current_user_role() in ('owner', 'family')
    or (
        current_user_role() = 'viewer'
        and not is_person_living(resolve_person_id(system, tree_id, husb_xref))
        and not is_person_living(resolve_person_id(system, tree_id, wife_xref))
    )
);

create policy person_privacy_select on person_privacy for select
using (current_user_role() in ('owner', 'family', 'viewer'));

-- finding is a curation tool (M4/M6), not public-facing - no viewer access.
create policy finding_select on finding for select
using (current_user_role() in ('owner', 'family'));

create policy finding_write on finding for all
using (current_user_role() = 'owner')
with check (current_user_role() = 'owner');

-- RLS restricts rows, not table-level access - authenticated still needs
-- the base grant to query these at all. Public signup is disabled (plan
-- §6 M5), so `anon` gets nothing.
grant select on person, persona, family_persona, person_privacy, app_user_role to authenticated;
grant select, insert, update, delete on finding to authenticated;
