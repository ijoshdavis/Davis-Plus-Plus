"""Duplicate person — same name + birth year; near-identical names sharing parents.

docs/build-plan.md M4. Known fixture: two "Lizzie Renfroe" records in the
Davis++ export, neither with a birth year - an unknown birth year is treated
as compatible with any other (including another unknown), not as a mismatch,
so this case is still caught. Clustering logic lives in rules/dedup.py,
shared with duplicate_family (a couple can be duplicated via two different,
themselves-duplicate, person records - see docs/decisions.md).
"""

from __future__ import annotations

from rules import gedcom_helpers as h
from rules.dedup import name_year_clusters
from rules.models import Finding, PersonRecord

RULE_NAME = "duplicate_person"


def run(persons: list[PersonRecord]) -> list[Finding]:
    findings = []
    for cluster in name_year_clusters(persons):
        if len(cluster) < 2:
            continue
        name_node = h.primary_name(cluster[0].raw)
        givn, surn = h.givn_surn(name_node)
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
