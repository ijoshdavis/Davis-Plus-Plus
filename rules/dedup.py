"""Shared person-deduplication clustering, used by both `duplicate_person`
(reports the clusters directly) and `duplicate_family` (uses them to catch a
couple duplicated via two different, themselves-duplicate, person records -
see docs/decisions.md, the duplicate_family gap noted when M4 first shipped).
"""

from __future__ import annotations

import re
from collections import defaultdict

from rules import gedcom_helpers as h
from rules.models import PersonRecord


def normalize(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def cluster_by_compatible_year(group: list[PersonRecord]) -> list[list[PersonRecord]]:
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
    return list(clusters.values())


def name_year_clusters(persons: list[PersonRecord]) -> list[list[PersonRecord]]:
    """All clusters of size >= 1 - same normalized name, compatible birth year."""
    groups: dict[tuple[str, str], list[PersonRecord]] = defaultdict(list)
    for p in persons:
        name_node = h.primary_name(p.raw)
        if not name_node:
            continue
        givn, surn = h.givn_surn(name_node)
        key = (normalize(givn), normalize(surn))
        if not key[0] or not key[1]:
            continue
        groups[key].append(p)

    clusters = []
    for group in groups.values():
        clusters.extend(cluster_by_compatible_year(group))
    return clusters


def canonical_xref_map(persons: list[PersonRecord]) -> dict[str, str]:
    """external_xref -> a deterministic representative xref for its cluster.

    Persons not part of any multi-member cluster aren't included - callers
    should fall back to the xref itself via .get(xref, xref).
    """
    mapping: dict[str, str] = {}
    for cluster in name_year_clusters(persons):
        if len(cluster) < 2:
            continue
        representative = min(p.external_xref for p in cluster)
        for p in cluster:
            mapping[p.external_xref] = representative
    return mapping
