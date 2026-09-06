"""Family back-reference integrity — a family's HUSB/WIFE doesn't list a FAMS
pointer back to that family.

Not in the build plan's original M4 list - added after Gramps' own import
auto-repaired this exact case on the Davis++ export (see docs/decisions.md,
families F468/F469). Gramps silently adds the missing reference; this rule
surfaces it instead so it's a reviewable finding rather than a silent fix.
"""

from __future__ import annotations

from rules import gedcom_helpers as h
from rules.models import FamilyRecord, Finding, PersonRecord

RULE_NAME = "family_back_reference"


def run(persons: list[PersonRecord], families: list[FamilyRecord]) -> list[Finding]:
    persons_by_xref = {p.external_xref: p for p in persons}
    findings = []
    for fam in families:
        for role, xref in (("HUSB", fam.husb_xref), ("WIFE", fam.wife_xref)):
            if not xref:
                continue
            person = persons_by_xref.get(xref)
            if person is None or fam.external_xref in h.fams_list(person.raw):
                continue
            findings.append(
                Finding(
                    rule=RULE_NAME,
                    severity="error",
                    subject={"person_ids": [person.person_id], "family_ids": [fam.family_persona_id]},
                    details={"role": role, "person_xref": xref, "family_xref": fam.external_xref},
                    suggested_fix={"add_fams": fam.external_xref, "to_person_xref": xref},
                )
            )
    return findings
