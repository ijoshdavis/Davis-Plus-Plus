"""Duplicate person — same name + birth year; near-identical names sharing parents.

docs/build-plan.md M4. Known fixture: two "Lizzie Renfroe" records in the
Davis++ export, neither with a birth year - an unknown birth year is treated
as compatible with any other (including another unknown), not as a mismatch,
so this case is still caught.
"""

from __future__ import annotations

import re
from collections import defaultdict

from rules import gedcom_helpers as h
from rules.models import Finding, PersonRecord

RULE_NAME = "duplicate_person"


def _normalize(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def _cluster_by_compatible_year(group: list[PersonRecord]) -> list[list[PersonRecord]]:
    years = [h.birth_year(p.raw) for p in group]
    parent = list(range(len(group)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[ri] = rj

    for i in range(len(group)):
        for j in range(i + 1, len(group)):
            if years[i] is None or years[j] is None or years[i] == years[j]:
                union(i, j)

    clusters: dict[int, list[PersonRecord]] = defaultdict(list)
    for idx, p in enumerate(group):
        clusters[find(idx)].append(p)
    return [c for c in clusters.values() if len(c) > 1]


def run(persons: list[PersonRecord]) -> list[Finding]:
    groups: dict[tuple[str, str], list[PersonRecord]] = defaultdict(list)
    for p in persons:
        name_node = h.primary_name(p.raw)
        if not name_node:
            continue
        givn, surn = h.givn_surn(name_node)
        key = (_normalize(givn), _normalize(surn))
        if not key[0] or not key[1]:
            continue
        groups[key].append(p)

    findings = []
    for (givn, surn), group in groups.items():
        if len(group) < 2:
            continue
        for cluster in _cluster_by_compatible_year(group):
            findings.append(
                Finding(
                    rule=RULE_NAME,
                    severity="warning",
                    subject={"person_ids": [m.person_id for m in cluster]},
                    details={
                        "name": f"{givn.title()} {surn.title()}",
                        "external_xrefs": [m.external_xref for m in cluster],
                        "birth_years": [h.birth_year(m.raw) for m in cluster],
                    },
                    suggested_fix=None,
                )
            )
    return findings
