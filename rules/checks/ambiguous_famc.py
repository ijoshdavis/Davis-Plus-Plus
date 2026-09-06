"""Ambiguous family-as-child — multiple FAMC with no PEDI to disambiguate them.

Not in the build plan's original M4 list - added after finding it live (see
docs/decisions.md, "Ronnie Lamar Davis"). Ancestry encodes step-relationships
with a non-standard `_FREL` tag on the family's CHIL line instead of the
GEDCOM-standard `PEDI` tag on the person's own FAMC line, so a person can
have two "families as child" with nothing in the file to say which is
biological. Known fixture: Ronnie Lamar Davis, FAMC @F416@ (birth father,
no mother) and @F93@ (mother's household, tagged _FREL step - which this
rule can't see, by design, since it's checking for the standard mechanism).
"""

from __future__ import annotations

from rules import gedcom_helpers as h
from rules.models import Finding, PersonRecord

RULE_NAME = "ambiguous_famc_pedigree"


def run(persons: list[PersonRecord]) -> list[Finding]:
    findings = []
    for p in persons:
        famcs = h.famc_list(p.raw)
        if len(famcs) < 2:
            continue
        pedi_by_famc = {fx: h.pedi_for_famc(p.raw, fx) for fx in famcs}
        if not any(v is None for v in pedi_by_famc.values()):
            continue  # every FAMC is already disambiguated

        name_node = h.primary_name(p.raw)
        givn, surn = h.givn_surn(name_node) if name_node else (None, None)
        findings.append(
            Finding(
                rule=RULE_NAME,
                severity="warning",
                subject={"person_ids": [p.person_id]},
                details={
                    "external_xref": p.external_xref,
                    "name": f"{givn or ''} {surn or ''}".strip(),
                    "famc_pedigree": pedi_by_famc,
                },
                suggested_fix=None,
            )
        )
    return findings
