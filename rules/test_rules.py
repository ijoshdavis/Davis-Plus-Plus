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
    duplicate_family,
    duplicate_person,
    family_back_reference,
    gender_inconsistency,
    impossible_dates,
    missing_married_name,
    name_hygiene,
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


def test_impossible_dates_catches_child_bride():
    persons = load_persons("child_bride_person.json")
    families = load_families("child_bride_family.json")
    findings = impossible_dates.run(persons, families)
    assert len(findings) == 1
    assert findings[0].details["kind"] == "marriage_before_min_age"
    assert findings[0].details["age_at_marriage"] == 2


def test_impossible_dates_ignores_clean_person():
    persons = load_persons("clean_control_person.json")
    assert impossible_dates.run(persons, []) == []


def test_missing_married_name_catches_mamie_stover():
    persons = load_persons("mamie_stover_family_persons.json")
    families = load_families("mamie_stover_family.json")
    findings = missing_married_name.run(persons, families)
    xrefs = {f.details["external_xref"] for f in findings}
    assert "@I302788161329@" in xrefs  # Mamie Pauline Stover
    assert "@I302788161369@" not in xrefs  # Johnnie Jefferson Davis is male, not a candidate


def test_duplicate_family_catches_alax_and_emily_ford():
    # Alax Ford + Emily J. Ford are recorded as a couple twice (@F44@, @F59@)
    # via two entirely different xrefs on *both* sides - only catchable by
    # canonical person clustering, not a raw husb/wife xref match. This was
    # a known gap (zero hits) when M4 first shipped - see docs/decisions.md.
    persons = load_persons("alax_emily_ford_persons.json")
    families = load_families("alax_emily_ford_families.json")
    findings = duplicate_family.run(persons, families)
    assert len(findings) == 1
    assert findings[0].details["via_duplicate_person"] is True
    assert set(findings[0].details["family_xrefs"]) == {"@F44@", "@F59@"}


def test_duplicate_family_ignores_distinct_couples_sharing_one_spouse():
    # Two different families that happen to share one spouse (e.g. a second
    # marriage) must not be flagged as the same couple duplicated.
    shared_spouse = load_families("mamie_stover_family.json")[0]
    other = FamilyRecord(
        family_persona_id="synthetic-1",
        external_xref="@F_SYNTHETIC@",
        husb_xref=shared_spouse.husb_xref,
        wife_xref="@I_SOMEONE_ELSE@",
        chil_xrefs=[],
        raw={"level": 0, "tag": "FAM", "xref": "@F_SYNTHETIC@", "children": []},
    )
    persons = load_persons("mamie_stover_family_persons.json")
    assert duplicate_family.run(persons, [shared_spouse, other]) == []


def test_name_hygiene_catches_davis_specimens():
    persons = load_persons("name_hygiene_davis.json")
    findings = name_hygiene.run(persons)
    kinds_by_xref = {}
    for f in findings:
        kinds_by_xref.setdefault(f.details["external_xref"], set()).add(f.details["kind"])
    assert kinds_by_xref["@I302788161946@"] == {"parenthetical_in_surname"}  # Alice Jane (Hardin) Aaron
    assert kinds_by_xref["@I302788162387@"] == {  # Bolton(4GGF)
        "parenthetical_in_surname",
        "research_annotation_in_surname",
    }
    assert kinds_by_xref["@I302788161754@"] == {"suffix_in_surname"}  # Smith Jr.


def test_name_hygiene_catches_ford_specimens():
    persons = load_persons("name_hygiene_ford.json")
    findings = name_hygiene.run(persons)
    kinds_by_xref = {}
    for f in findings:
        kinds_by_xref.setdefault(f.details["external_xref"], set()).add(f.details["kind"])
    assert kinds_by_xref["@I34039528489@"] == {"unbalanced_quotes"}  # Evelyn Irene "Eva" Evie"
    assert kinds_by_xref["@I_CL016@"] == {"empty_surname"}  # Susannah //


def test_name_hygiene_ignores_clean_person():
    persons = load_persons("clean_control_person.json")
    assert name_hygiene.run(persons) == []
