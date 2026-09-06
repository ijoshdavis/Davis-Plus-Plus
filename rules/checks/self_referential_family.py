"""Self-referential family — HUSB and WIFE point at the same person.

Not in the build plan's original M4 list - found while investigating why
family_back_reference fired twice for the same person+family (see
docs/decisions.md, families F468/F469: both list George W Mayo / a second
person as HUSB *and* WIFE of the same marriage). Ancestry tags these `_SREL
unknown`, suggesting even its own matching flagged uncertainty. This is a
clearer, more severe fact than "missing back-reference" - surfaced as its
own finding rather than left as two confusing role-flipped reports.
"""

from __future__ import annotations

from rules.models import FamilyRecord, Finding

RULE_NAME = "self_referential_family"


def run(families: list[FamilyRecord]) -> list[Finding]:
    findings = []
    for fam in families:
        if fam.husb_xref and fam.husb_xref == fam.wife_xref:
            findings.append(
                Finding(
                    rule=RULE_NAME,
                    severity="error",
                    subject={"family_ids": [fam.family_persona_id]},
                    details={"family_xref": fam.external_xref, "person_xref": fam.husb_xref},
                    suggested_fix=None,
                )
            )
    return findings
