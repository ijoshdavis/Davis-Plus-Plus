-- M4 — Rules engine (see docs/build-plan.md §6 M4)
--
-- Findings are read-only output of rules run against the M2 store. Rules
-- never mutate persona/family_persona (immutable, §1.2) or write conclusions
-- directly - a finding is a candidate for a human (M6) to review and apply,
-- which is what will eventually produce a `change` row.

create table finding (
    id            uuid primary key default gen_random_uuid(),
    rule          text not null,
    severity      text not null check (severity in ('error', 'warning', 'info')),
    tree_id       text,
    subject       jsonb not null,   -- {"person_ids": [...], "family_ids": [...]} - local ids
    details       jsonb not null,   -- rule-specific evidence, human-readable
    suggested_fix jsonb,            -- rule-specific suggestion, nullable
    status        text not null default 'open' check (status in ('open', 'accepted', 'dismissed')),
    created_at    timestamptz not null default now()
);

create index on finding (rule);
create index on finding (tree_id);
create index on finding (status);
