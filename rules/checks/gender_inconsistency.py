"""Gender inconsistency — given name strongly disagrees with recorded sex.

docs/build-plan.md M4: "given name strongly disagrees with recorded sex."
Known fixture: Hezekiah Herring recorded as SEX F in the Davis++ export.
"""

from __future__ import annotations

import gender_guesser.detector as gender_module

from rules import gedcom_helpers as h
from rules.models import Finding, PersonRecord

RULE_NAME = "gender_inconsistency"

_detector = gender_module.Detector()
_CONFIDENT = {"male": "M", "female": "F"}


def run(persons: list[PersonRecord]) -> list[Finding]:
    findings = []
    for p in persons:
        name_node = h.primary_name(p.raw)
        if not name_node:
            continue
        givn, surn = h.givn_surn(name_node)
        recorded_sex = h.sex(p.raw)
        if not givn or recorded_sex not in ("M", "F"):
            continue

        first_name = givn.split()[0]
        guess = _detector.get_gender(first_name)
        guessed_sex = _CONFIDENT.get(guess)
        if guessed_sex is None or guessed_sex == recorded_sex:
            continue

        findings.append(
            Finding(
                rule=RULE_NAME,
                severity="warning",
                subject={"person_ids": [p.person_id]},
                details={
                    "external_xref": p.external_xref,
                    "given_name": givn,
                    "surname": surn,
                    "recorded_sex": recorded_sex,
                    "name_implies_sex": guessed_sex,
                },
                suggested_fix={"field": "sex", "from": recorded_sex, "to": guessed_sex},
            )
        )
    return findings
