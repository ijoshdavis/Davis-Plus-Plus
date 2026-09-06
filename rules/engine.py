"""M4 rules engine runner (see docs/build-plan.md §6 M4).

Loads personas/families for a tree from the M2 store, runs every check, and
persists the results as `finding` rows. Findings are recomputed from scratch
on each run (old findings for the rule+tree are replaced) - the store,
not the finding table, is the source of truth.

Usage:
    uv run python -m rules.engine <tree_id> <database_url>
"""

from __future__ import annotations

import sys

import psycopg
from psycopg.types.json import Jsonb

from rules import store
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
from rules.models import Finding

# Rules taking (persons) vs (families) vs (persons, families) are wired up
# explicitly below rather than forced into one signature - a handful of
# rules is not enough to justify a plugin abstraction over a plain list.
PERSON_RULES = [gender_inconsistency, duplicate_person, ambiguous_famc, name_hygiene]
FAMILY_RULES = [self_referential_family, duplicate_family]
PERSON_FAMILY_RULES = [family_back_reference, impossible_dates, missing_married_name]
ALL_RULE_MODULES = PERSON_RULES + FAMILY_RULES + PERSON_FAMILY_RULES


def run_all(cur: psycopg.Cursor, tree_id: str) -> list[Finding]:
    persons = store.load_persons(cur, tree_id)
    families = store.load_families(cur, tree_id)

    findings: list[Finding] = []
    for module in PERSON_RULES:
        findings.extend(module.run(persons))
    for module in FAMILY_RULES:
        findings.extend(module.run(families))
    for module in PERSON_FAMILY_RULES:
        findings.extend(module.run(persons, families))
    return findings


def persist(cur: psycopg.Cursor, tree_id: str, findings: list[Finding]) -> None:
    rule_names = {m.RULE_NAME for m in ALL_RULE_MODULES}
    for rule_name in rule_names:
        cur.execute("delete from finding where rule = %s and tree_id = %s", (rule_name, tree_id))

    for f in findings:
        cur.execute(
            """insert into finding (rule, severity, tree_id, subject, details, suggested_fix)
               values (%s, %s, %s, %s, %s, %s)""",
            (
                f.rule,
                f.severity,
                tree_id,
                Jsonb(f.subject),
                Jsonb(f.details),
                Jsonb(f.suggested_fix) if f.suggested_fix is not None else None,
            ),
        )


def main(argv: list[str]) -> None:
    tree_id, database_url = argv
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            findings = run_all(cur, tree_id)
            persist(cur, tree_id, findings)
        conn.commit()
    print(f"{tree_id}: {len(findings)} findings")
    by_rule: dict[str, int] = {}
    for f in findings:
        by_rule[f.rule] = by_rule.get(f.rule, 0) + 1
    for rule_name, count in sorted(by_rule.items()):
        print(f"  {rule_name}: {count}")


if __name__ == "__main__":
    main(sys.argv[1:])
