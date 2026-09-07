-- Fixes a real bug from migration 0004: resolve_person_id(p_system, ...)
-- took the caller's `system` value and matched it against
-- person_external_id.system - but those are two different vocabularies
-- that happen to share a column name. family_persona.system is the
-- *ingest adapter* name ('ancestry_gedcom'); person_external_id.system is
-- the *identity namespace* ('ancestry_pid'). Every call site passed the
-- adapter name, so the function always returned NULL.
--
-- Consequence: family_persona_select's viewer branch called
-- is_person_living(NULL), which defaults to true (conservative - "unknown
-- person, assume living") - so `not is_person_living(...)` was always
-- false for both spouses. A viewer role could never see *any*
-- family_persona row, deceased or not, regardless of the actual privacy
-- policy this was supposed to implement. Found while building the
-- family_membership view below and getting zero rows for a person known
-- to have families.
--
-- Fix: person_external_id only ever holds 'ancestry_pid' for these
-- GEDCOM-sourced xrefs regardless of which adapter wrote the referencing
-- row, so drop the parameter entirely rather than pass the wrong value.

drop policy family_persona_select on family_persona;
drop function resolve_person_id(text, text, text);

create function resolve_person_id(p_tree_id text, p_xref text) returns uuid
language sql stable
as $$
    select person_id from person_external_id
    where system = 'ancestry_pid' and tree_id = p_tree_id and value = p_xref
    limit 1
$$;

create policy family_persona_select on family_persona for select
using (
    current_user_role() in ('owner', 'family')
    or (
        current_user_role() = 'viewer'
        and not is_person_living(resolve_person_id(tree_id, husb_xref))
        and not is_person_living(resolve_person_id(tree_id, wife_xref))
    )
);

-- M6: resolves family_persona's raw husb_xref/wife_xref/chil_xrefs (external
-- GEDCOM pointers, per §1.5 - never a local FK) into actual person_id rows,
-- one row per (family, person, role) - lets the UI ask "what families is
-- this person in, and who else is in them" without hand-rolling the
-- xref->person_id resolution client-side for three different shapes
-- (single husb, single wife, an array of children).
--
-- security_invoker = true (PG15+) so RLS on family_persona/person_external_id
-- applies to whoever queries the view, not to the view's owner - otherwise a
-- view silently bypasses RLS by running with the creator's privileges.
create view family_membership
with (security_invoker = true)
as
select fp.id as family_persona_id, fp.tree_id, fp.external_xref as family_xref,
       resolve_person_id(fp.tree_id, fp.husb_xref) as person_id, 'husb' as role
from family_persona fp
where fp.husb_xref is not null
union all
select fp.id, fp.tree_id, fp.external_xref,
       resolve_person_id(fp.tree_id, fp.wife_xref), 'wife'
from family_persona fp
where fp.wife_xref is not null
union all
select fp.id, fp.tree_id, fp.external_xref,
       resolve_person_id(fp.tree_id, c.xref), 'child'
from family_persona fp, unnest(fp.chil_xrefs) as c(xref);

grant select on family_membership to authenticated;
