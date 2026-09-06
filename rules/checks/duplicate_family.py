"""Duplicate family (plan-required): same couple recorded more than once;
marriage dates within a few days of each other.

Groups families by their spouses' *canonical* identity (rules/dedup.py's
person clusters), not raw xref - so this catches both a literal repeated
xref pair, and the same couple recorded twice because one or both spouses
are themselves duplicate person records (e.g. two "Lizzie Renfroe" records
each married into their own family entry would make those two families a
duplicate pair too, even though the four xrefs involved are all different).
This was a known gap when M4 first shipped - see docs/decisions.md. Where
records do carry a marriage date, "within a few days" is reported as extra
corroboration in `details`, not as a filter - a couple can be duplicated
with one of the two records simply missing a date.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date

from rules import gedcom_helpers as h
from rules.dedup import canonical_xref_map
from rules.models import FamilyRecord, Finding, PersonRecord

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


def run(persons: list[PersonRecord], families: list[FamilyRecord]) -> list[Finding]:
    canon = canonical_xref_map(persons)
    groups: dict[frozenset[str], list[FamilyRecord]] = defaultdict(list)
    for fam in families:
        if not fam.husb_xref or not fam.wife_xref:
            continue
        key = frozenset({canon.get(fam.husb_xref, fam.husb_xref), canon.get(fam.wife_xref, fam.wife_xref)})
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
                    "husb_xrefs": sorted({f.husb_xref for f in group}),
                    "wife_xrefs": sorted({f.wife_xref for f in group}),
                    "family_xrefs": [f.external_xref for f in group],
                    "marriage_dates": [d.isoformat() if d else None for d in dates],
                    "days_apart": days_apart,
                    "via_duplicate_person": len({f.husb_xref for f in group}) > 1
                    or len({f.wife_xref for f in group}) > 1,
                },
                suggested_fix=None,
            )
        )
    return findings
