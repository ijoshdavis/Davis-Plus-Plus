"""Impossible dates (plan-required): child before parent, death before birth,
marriage before age 12.
"""

from __future__ import annotations

from rules import gedcom_helpers as h
from rules.models import FamilyRecord, Finding, PersonRecord

RULE_NAME = "impossible_dates"

_MIN_MARRIAGE_AGE = 12


def run(persons: list[PersonRecord], families: list[FamilyRecord]) -> list[Finding]:
    findings = []
    persons_by_xref = {p.external_xref: p for p in persons}

    for p in persons:
        birth, death = h.birth_year(p.raw), h.death_year(p.raw)
        if birth is not None and death is not None and death < birth:
            findings.append(
                Finding(
                    rule=RULE_NAME,
                    severity="error",
                    subject={"person_ids": [p.person_id]},
                    details={
                        "kind": "death_before_birth",
                        "external_xref": p.external_xref,
                        "birth_year": birth,
                        "death_year": death,
                    },
                )
            )

    for fam in families:
        marriage_year = h.marriage_year(fam.raw)
        for role, xref in (("HUSB", fam.husb_xref), ("WIFE", fam.wife_xref)):
            spouse = persons_by_xref.get(xref) if xref else None
            if spouse is None:
                continue
            birth = h.birth_year(spouse.raw)
            if birth is None:
                continue
            if marriage_year is not None and marriage_year - birth < _MIN_MARRIAGE_AGE:
                findings.append(
                    Finding(
                        rule=RULE_NAME,
                        severity="error",
                        subject={"person_ids": [spouse.person_id], "family_ids": [fam.family_persona_id]},
                        details={
                            "kind": "marriage_before_min_age",
                            "role": role,
                            "external_xref": spouse.external_xref,
                            "birth_year": birth,
                            "marriage_year": marriage_year,
                            "age_at_marriage": marriage_year - birth,
                        },
                    )
                )
            for child_xref in fam.chil_xrefs:
                child = persons_by_xref.get(child_xref)
                if child is None:
                    continue
                child_birth = h.birth_year(child.raw)
                if child_birth is not None and child_birth <= birth:
                    findings.append(
                        Finding(
                            rule=RULE_NAME,
                            severity="error",
                            subject={
                                "person_ids": [child.person_id, spouse.person_id],
                                "family_ids": [fam.family_persona_id],
                            },
                            details={
                                "kind": "child_before_parent",
                                "parent_role": role,
                                "parent_xref": spouse.external_xref,
                                "parent_birth_year": birth,
                                "child_xref": child.external_xref,
                                "child_birth_year": child_birth,
                            },
                        )
                    )
    return findings
