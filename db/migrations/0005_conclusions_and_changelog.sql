-- M6 — Read model + first front end (see docs/build-plan.md §5, §6 M6)
--
-- The first real conclusion-layer table. M2 deliberately stopped at
-- personas (§1.2 - never flatten on import); M6 is where a human first
-- concludes something from them, so this is where person_name has to
-- exist. change is the append-only log every write goes through (§5:
-- "a mutation that bypasses the log is a bug") - person_name writes are
-- the first thing that logs to it.

create table person_name (
    id         uuid primary key default gen_random_uuid(),
    person_id  uuid not null references person(id) on delete cascade,
    type       text not null check (type in ('birth', 'married', 'aka', 'nickname')),
    given      text,
    surname    text,
    suffix     text,
    preferred  boolean not null default false,
    created_at timestamptz not null default now()
);

create index on person_name (person_id);

create table change (
    id          uuid primary key default gen_random_uuid(),
    entity      text not null,        -- e.g. 'person_name', 'finding'
    entity_id   uuid not null,
    field       text,
    old_value   jsonb,
    new_value   jsonb,
    actor       uuid references auth.users(id),
    source      text not null,        -- e.g. 'finding:missing_married_name'
    occurred_at timestamptz not null default now()
);

create index on change (entity, entity_id);

alter table person_name enable row level security;
alter table change enable row level security;

-- Conclusions are read-visible under the same living/deceased split as
-- person/persona; only owner writes them (M6's first UI is owner-only
-- curation - family/viewer are read-only consumers of the result).
create policy person_name_select on person_name for select
using (
    current_user_role() in ('owner', 'family')
    or (current_user_role() = 'viewer' and not is_person_living(person_id))
);

create policy person_name_write on person_name for insert
to authenticated
with check (current_user_role() = 'owner');

create policy change_select on change for select
using (current_user_role() in ('owner', 'family'));

create policy change_write on change for insert
to authenticated
with check (current_user_role() = 'owner');

grant select, insert on person_name, change to authenticated;

-- Applies one missing_married_name finding: writes the conclusion, logs the
-- change, marks the finding accepted - atomically, in one round trip from
-- the UI. security invoker (default) so the caller's own RLS still applies:
-- person_name_write/change_write already restrict inserts to owner, so this
-- naturally fails for non-owners rather than needing its own check.
create or replace function apply_missing_married_name(
    p_finding_id uuid,
    p_given text,
    p_surname text
) returns uuid
language plpgsql
security invoker
as $$
declare
    v_person_id uuid;
    v_name_id uuid;
begin
    select (subject->'person_ids'->>0)::uuid into v_person_id
    from finding where id = p_finding_id and rule = 'missing_married_name';

    if v_person_id is null then
        raise exception 'finding % not found or not a missing_married_name finding', p_finding_id;
    end if;

    insert into person_name (person_id, type, given, surname, preferred)
    values (v_person_id, 'married', p_given, p_surname, true)
    returning id into v_name_id;

    insert into change (entity, entity_id, field, old_value, new_value, actor, source)
    values (
        'person_name', v_name_id, 'married_name', null,
        jsonb_build_object('given', p_given, 'surname', p_surname),
        auth.uid(), 'finding:' || p_finding_id
    );

    update finding set status = 'accepted' where id = p_finding_id;

    return v_name_id;
end;
$$;

grant execute on function apply_missing_married_name(uuid, text, text) to authenticated;
