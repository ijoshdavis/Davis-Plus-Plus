-- Research/action queue, seeded by reviewing Davis++ live on Ancestry.com
-- (see docs/decisions.md, "Ronnie Lamar Davis" ambiguous FAMC and "Evelyn
-- Irene Lutton" young-parent gap).
--
-- A finding says something looks wrong; a research_task is the concrete
-- next step toward resolving it. Two kinds, kept explicit in the schema
-- rather than just in prose:
--   - user_decision   - a judgment call only the owner can make (e.g. does
--     a biological/step split match known family history).
--   - chrome_research - read-only lookups on Ancestry.com (checking hints,
--     pulling a census image, confirming a fact) that can be approved for
--     Claude to carry out. Never a write: build-plan.md's Ancestry
--     constraints are explicit and non-negotiable - "This project never
--     writes to Ancestry over HTTP. Export -> RootsMagic -> TreeShare is
--     the only write path." Any actual correction still goes through the
--     existing finding/person_name/change flow, same as always.
--
-- Same owner/family-read, owner-write access pattern as `finding` (§M5) -
-- this is curation workflow data, not public-facing.

create table research_task (
    id           uuid primary key default gen_random_uuid(),
    finding_id   uuid not null references finding(id) on delete cascade,
    kind         text not null check (kind in ('user_decision', 'chrome_research')),
    instructions text not null,
    status       text not null default 'proposed' check (status in ('proposed', 'approved', 'declined', 'done')),
    result       text,
    created_at   timestamptz not null default now()
);

create index on research_task (finding_id);
create index on research_task (status);

alter table research_task enable row level security;

create policy research_task_select on research_task for select
using (current_user_role() in ('owner', 'family'));

create policy research_task_write on research_task for all
using (current_user_role() = 'owner')
with check (current_user_role() = 'owner');

grant select, insert, update, delete on research_task to authenticated;
