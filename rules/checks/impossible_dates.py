"""Impossible dates (plan-required): child before parent, death before birth,
marriage before age 12. Also flags an implausibly young parent (a positive
but sub-15 age at a child's birth) even when there's no marriage record to
catch it via marriage_before_min_age - see docs/decisions.md, "Evelyn Irene
Lutton": a non-marital child recorded with no source, born when the mother
would have been about 14, that no existing rule caught.
"""

from __future__ import annotations

from rules import gedcom_helpers as h
from rules.models import FamilyRecord, Finding, PersonRecord

RULE_NAME = "impossible_dates"

_MIN_MARRIAGE_AGE = 12
# Looser than _MIN_MARRIAGE_AGE on purpose: this fires on any parent-child
# pair, married or not, so it needs to catch a wider "worth a human look"
# band rather than only the near-impossible.
_MIN_PLAUSIBLE_PARENT_AGE = 15


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
                elif child_birth is not None and child_birth - birth < _MIN_PLAUSIBLE_PARENT_AGE:
                    findings.append(
                        Finding(
                            rule=RULE_NAME,
                            severity="warning",
                            subject={
                                "person_ids": [child.person_id, spouse.person_id],
                                "family_ids": [fam.family_persona_id],
                            },
                            details={
                                "kind": "young_parent",
                                "parent_role": role,
                                "parent_xref": spouse.external_xref,
                                "parent_birth_year": birth,
                                "child_xref": child.external_xref,
                                "child_birth_year": child_birth,
                                "age_at_child_birth": child_birth - birth,
                            },
                        )
                    )
    return findings
