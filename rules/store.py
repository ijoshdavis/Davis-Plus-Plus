from __future__ import annotations

import psycopg

from rules.models import FamilyRecord, PersonRecord


def load_persons(cur: psycopg.Cursor, tree_id: str) -> list[PersonRecord]:
    cur.execute(
        "select person_id, external_xref, raw from persona where tree_id = %s",
        (tree_id,),
    )
    return [PersonRecord(person_id=str(r[0]), external_xref=r[1], raw=r[2]) for r in cur.fetchall()]


def load_families(cur: psycopg.Cursor, tree_id: str) -> list[FamilyRecord]:
    cur.execute(
        """select id, external_xref, husb_xref, wife_xref, chil_xrefs, raw
           from family_persona where tree_id = %s""",
        (tree_id,),
    )
    return [
        FamilyRecord(
            family_persona_id=str(r[0]),
            external_xref=r[1],
            husb_xref=r[2],
            wife_xref=r[3],
            chil_xrefs=r[4],
            raw=r[5],
        )
        for r in cur.fetchall()
    ]
