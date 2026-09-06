"""Name hygiene (plan-required): parentheticals, unbalanced quotes, research
annotations in surname fields, suffixes in surname, empty surnames.

Every sub-check has a confirmed real specimen in this data (see
docs/decisions.md): parentheticals and research annotations and suffixes in
Davis++, unbalanced quotes and empty surname in Ford-Davis-Tree.
"""

from __future__ import annotations

import re

from rules import gedcom_helpers as h
from rules.models import Finding, PersonRecord

RULE_NAME = "name_hygiene"

_SUFFIX_RE = re.compile(r"\b(Jr|Sr|II|III|IV|V)\b\.?", re.IGNORECASE)
_ANNOTATION_RE = re.compile(r"\d|ggf|ggm", re.IGNORECASE)


def _check_name(person_id: str, external_xref: str, name_node: dict) -> list[Finding]:
    findings = []
    givn, surn = h.givn_surn(name_node)
    full_payload = name_node.get("payload") or ""

    if givn and full_payload.count('"') % 2 == 1:
        findings.append(_finding(person_id, external_xref, "unbalanced_quotes", {"given_name": givn}))

    if surn and "(" in surn and ")" in surn:
        findings.append(_finding(person_id, external_xref, "parenthetical_in_surname", {"surname": surn}))

    if surn and _ANNOTATION_RE.search(surn):
        findings.append(_finding(person_id, external_xref, "research_annotation_in_surname", {"surname": surn}))

    if surn and _SUFFIX_RE.search(surn):
        findings.append(_finding(person_id, external_xref, "suffix_in_surname", {"surname": surn}))

    if givn and not surn:
        findings.append(_finding(person_id, external_xref, "empty_surname", {"given_name": givn}))

    return findings


def _finding(person_id: str, external_xref: str, kind: str, extra: dict) -> Finding:
    return Finding(
        rule=RULE_NAME,
        severity="warning",
        subject={"person_ids": [person_id]},
        details={"kind": kind, "external_xref": external_xref, **extra},
        suggested_fix=None,
    )


def run(persons: list[PersonRecord]) -> list[Finding]:
    findings = []
    for p in persons:
        for name_node in h.find_children(p.raw, "NAME"):
            findings.extend(_check_name(p.person_id, p.external_xref, name_node))
    return findings
