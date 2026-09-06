"""M3 — GEDCOM export writer (see docs/build-plan.md §6 M3).

The inverse of ingest.ancestry_gedcom.load.build_batch(): reconstructs a
GEDCOM 5.5.1 file for one tree_id from what M2 stored. `persona.raw` /
`family_persona.raw` already hold a complete structure_to_dict() snapshot of
the original INDI/FAM record - including inline citations and `_APID` - so
exporting those is a direct rebuild, not a re-derivation. SOUR/REPO records
were normalized out of the personas at ingest time, so those get rebuilt from
the `source`/`repository` tables instead.

Usage:
    uv run python -m export.ancestry_gedcom.write <tree_id> <database_url> <output_path>
"""

from __future__ import annotations

import sys

import gedcom_lite as g
import psycopg

# A minimal, valid HEAD/SUBM/TRLR skeleton - reused rather than hand-built so
# gedcom-lite's own header/trailer formatting is what ends up on disk.
_SKELETON = b"""0 HEAD
1 SOUR Kinstore
2 VERS 0.1.0
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @SUBM1@ SUBM
1 NAME Kinstore Export
0 TRLR
"""


def structure_from_dict(d: dict) -> g.Structure:
    node = g.Structure(level=d["level"], tag=d["tag"], payload=d.get("payload"), xref=d.get("xref"))
    node._dirty = True
    for child_d in d.get("children", []):
        child = structure_from_dict(child_d)
        child.parent = node
        node.children.append(child)
    return node


def _add_record_from_dict(doc: g.GedcomDocument, d: dict) -> None:
    node = structure_from_dict(d)
    doc.records.append(node)
    if node.xref:
        doc.xrefs[node.xref] = node


def _fetchall(cur: psycopg.Cursor, query: str, params: tuple) -> list[dict]:
    cur.execute(query, params)
    cols = [c.name for c in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def build_repository_record(doc: g.GedcomDocument, repo: dict) -> None:
    rec = doc.add_record("REPO", xref=repo["external_xref"])
    rec.add_child("NAME", repo["name"])
    if repo["addr"]:
        rec.add_child("ADDR", repo["addr"])


def build_source_record(doc: g.GedcomDocument, src: dict, repo_xref_by_id: dict[str, str]) -> None:
    rec = doc.add_record("SOUR", xref=src["external_xref"])
    if src["title"] is not None:
        rec.add_child("TITL", src["title"])
    if src["author"] is not None:
        rec.add_child("AUTH", src["author"])
    if src["publ"] is not None or src["publ_date"] is not None or src["publ_place"] is not None:
        publ = rec.add_child("PUBL", src["publ"])
        if src["publ_date"] is not None:
            publ.add_child("DATE", src["publ_date"])
        if src["publ_place"] is not None:
            publ.add_child("PLAC", src["publ_place"])
    if src["apid_db_id"] is not None:
        rec.add_child("_APID", src["apid_db_id"])
    if src["repository_id"] is not None:
        repo_xref = repo_xref_by_id.get(src["repository_id"])
        if repo_xref is not None:
            rec.add_child("REPO", repo_xref)


def export_tree(tree_id: str, database_url: str, output_path: str) -> bytes:
    doc = g.GedcomDocument.parse(_SKELETON)

    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            repos = _fetchall(
                cur, "select id, name, addr, external_xref from repository where tree_id = %s", (tree_id,)
            )
            sources = _fetchall(
                cur,
                """select id, external_xref, title, author, publ, publ_date, publ_place,
                          apid_db_id, repository_id
                   from source where tree_id = %s""",
                (tree_id,),
            )
            personas = _fetchall(cur, "select raw from persona where tree_id = %s order by external_xref", (tree_id,))
            family_personas = _fetchall(
                cur, "select raw from family_persona where tree_id = %s order by external_xref", (tree_id,)
            )

    for repo in repos:
        build_repository_record(doc, repo)

    repo_xref_by_id = {r["id"]: r["external_xref"] for r in repos}
    for src in sources:
        build_source_record(doc, src, repo_xref_by_id)

    for row in personas:
        _add_record_from_dict(doc, row["raw"])
    for row in family_personas:
        _add_record_from_dict(doc, row["raw"])

    return doc.write(output_path)


def main(argv: list[str]) -> None:
    tree_id, database_url, output_path = argv
    export_tree(tree_id, database_url, output_path)


if __name__ == "__main__":
    main(sys.argv[1:])
