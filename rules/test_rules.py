"""Regression fixtures for the M4 rules engine (docs/build-plan.md §6 M4:
"these are regression fixtures; commit them as tests"). Each fixture is a
real record pulled from the Davis++ store, not synthetic data - see
docs/decisions.md for how each was found.

Run: uv run pytest rules/
"""

from __future__ import annotations

import json
from pathlib import Path

from rules.checks import (
    ambiguous_famc,
    duplicate_person,
    family_back_reference,
    gender_inconsistency,
    self_referential_family,
)
from rules.models import FamilyRecord, PersonRecord

FIXTURES = Path(__file__).parent / "fixtures"


def load_persons(name: str) -> list[PersonRecord]:
    data = json.loads((FIXTURES / name).read_text())
    return [PersonRecord(person_id=d["person_id"], external_xref=d["external_xref"], raw=d["raw"]) for d in data]


def load_families(name: str) -> list[FamilyRecord]:
    data = json.loads((FIXTURES / name).read_text())
    return [
        FamilyRecord(
            family_persona_id=d["family_persona_id"],
            external_xref=d["external_xref"],
            husb_xref=d["husb_xref"],
            wife_xref=d["wife_xref"],
            chil_xrefs=d["chil_xrefs"],
            raw=d["raw"],
        )
        for d in data
    ]


def test_gender_inconsistency_catches_hezekiah_herring():
    persons = load_persons("hezekiah_herring.json")
    findings = gender_inconsistency.run(persons)
    assert len(findings) == 1
    assert findings[0].details["recorded_sex"] == "F"
    assert findings[0].details["name_implies_sex"] == "M"


def test_gender_inconsistency_ignores_clean_person():
    persons = load_persons("clean_control_person.json")
    assert gender_inconsistency.run(persons) == []


def test_duplicate_person_catches_lizzie_renfroe_pair():
    persons = load_persons("lizzie_renfroe_pair.json")
    findings = duplicate_person.run(persons)
    assert len(findings) == 1
    assert set(findings[0].subject["person_ids"]) == {p.person_id for p in persons}


def test_duplicate_person_ignores_clean_person():
    persons = load_persons("clean_control_person.json")
    assert duplicate_person.run(persons) == []


def test_ambiguous_famc_catches_ronnie_lamar_davis():
    persons = load_persons("ronnie_lamar_davis.json")
    findings = ambiguous_famc.run(persons)
    assert len(findings) == 1
    assert set(findings[0].details["famc_pedigree"]) == {"@F416@", "@F93@"}
    assert all(v is None for v in findings[0].details["famc_pedigree"].values())


def test_ambiguous_famc_ignores_clean_person():
    persons = load_persons("clean_control_person.json")
    assert ambiguous_famc.run(persons) == []


def test_self_referential_family_catches_mayo_marriage():
    families = load_families("self_ref_families.json")
    findings = self_referential_family.run(families)
    assert {f.details["family_xref"] for f in findings} == {"@F468@", "@F469@"}


def test_family_back_reference_catches_self_referential_families():
    persons = load_persons("self_ref_family_persons.json")
    families = load_families("self_ref_families.json")
    findings = family_back_reference.run(persons, families)
    # both HUSB and WIFE roles fail, for both families
    assert len(findings) == 4
    assert {f.details["family_xref"] for f in findings} == {"@F468@", "@F469@"}
