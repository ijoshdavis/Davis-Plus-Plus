"""Duplicate family (plan-required): same couple recorded more than once;
marriage dates within a few days of each other.

The primary signal is exact: two family_persona rows in the same tree naming
the same two people (by xref) as HUSB/WIFE is already Ancestry recording the
same couple twice, regardless of what the marriage dates say. Where both
records do carry a marriage date, "within a few days" is reported as extra
corroboration in `details`, not as a filter - a couple can be duplicated
with one of the two records simply missing a date.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date

from rules import gedcom_helpers as h
from rules.models import FamilyRecord, Finding

RULE_NAME = "duplicate_family"

_MONTHS = {
    m: i + 1
    for i, m in enumerate(
        ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
    )
}


def _marriage_date(fam: FamilyRecord) -> date | None:
    marr = h.find_child(fam.raw, "MARR")
    date_node = h.find_child(marr, "DATE") if marr else None
    payload = date_node.get("payload") if date_node else None
    if not payload:
        return None
    parts = payload.upper().split()
    if len(parts) == 3 and parts[1] in _MONTHS:
        try:
            return date(int(parts[2]), _MONTHS[parts[1]], int(parts[0]))
        except ValueError:
            return None
    return None


def run(families: list[FamilyRecord]) -> list[Finding]:
    groups: dict[frozenset[str], list[FamilyRecord]] = defaultdict(list)
    for fam in families:
        if not fam.husb_xref or not fam.wife_xref:
            continue
        key = frozenset({fam.husb_xref, fam.wife_xref})
        groups[key].append(fam)

    findings = []
    for group in groups.values():
        if len(group) < 2:
            continue
        dates = [_marriage_date(f) for f in group]
        known_dates = [d for d in dates if d is not None]
        days_apart = (max(known_dates) - min(known_dates)).days if len(known_dates) >= 2 else None
        findings.append(
            Finding(
                rule=RULE_NAME,
                severity="warning",
                subject={"family_ids": [f.family_persona_id for f in group]},
                details={
                    "husb_xref": group[0].husb_xref,
                    "wife_xref": group[0].wife_xref,
                    "family_xrefs": [f.external_xref for f in group],
                    "marriage_dates": [d.isoformat() if d else None for d in dates],
                    "days_apart": days_apart,
                },
                suggested_fix=None,
            )
        )
    return findings
