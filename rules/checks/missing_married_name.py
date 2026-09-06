"""Missing married name (plan-required): women with a documented marriage and
no married-name row, scored on likelihood of earning record matches (lived
past 1850; died after 1935; marriage documented; sources attached).

There's no explicit "birth name" vs "married name" tag in this data - Ancestry
just gives a list of NAME records per person with no type label. The signal
used here is: every NAME record on file shares the same surname despite a
documented marriage, i.e. no alternate-surname NAME record exists at all.
Whether the on-file surname is her birth or married name is exactly the kind
of thing this is meant to surface for a human, not resolve here.
"""

from __future__ import annotations

from rules import gedcom_helpers as h
from rules.models import FamilyRecord, Finding, PersonRecord

RULE_NAME = "missing_married_name"


def _all_surnames(raw: dict) -> set[str]:
    surnames = set()
    for name_node in h.find_children(raw, "NAME"):
        _, surn = h.givn_surn(name_node)
        if surn:
            surnames.add(surn.strip().lower())
    return surnames


def _has_any_source(raw: dict) -> bool:
    stack = [raw]
    while stack:
        node = stack.pop()
        if node.get("tag") == "SOUR":
            return True
        stack.extend(node.get("children", []))
    return False


def run(persons: list[PersonRecord], families: list[FamilyRecord]) -> list[Finding]:
    families_by_xref = {f.external_xref: f for f in families}
    findings = []

    for p in persons:
        if h.sex(p.raw) != "F":
            continue
        fams_xrefs = h.fams_list(p.raw)
        married_fams = [families_by_xref[x] for x in fams_xrefs if x in families_by_xref]
        documented = [f for f in married_fams if h.find_child(f.raw, "MARR") is not None]
        if not documented:
            continue
        if len(_all_surnames(p.raw)) > 1:
            continue  # an alternate surname is already on file

        birth = h.birth_year(p.raw)
        death = h.death_year(p.raw)
        score = sum(
            [
                1,  # marriage documented - required to reach this point
                1 if birth is not None and birth > 1850 else 0,
                1 if death is not None and death > 1935 else 0,
                1 if _has_any_source(p.raw) else 0,
            ]
        )

        name_node = h.primary_name(p.raw)
        givn, surn = h.givn_surn(name_node) if name_node else (None, None)
        findings.append(
            Finding(
                rule=RULE_NAME,
                severity="info",
                subject={"person_ids": [p.person_id]},
                details={
                    "external_xref": p.external_xref,
                    "name": f"{givn or ''} {surn or ''}".strip(),
                    "birth_year": birth,
                    "death_year": death,
                    "has_source": _has_any_source(p.raw),
                    "likelihood_score": score,
                },
                suggested_fix=None,
            )
        )
    return findings
