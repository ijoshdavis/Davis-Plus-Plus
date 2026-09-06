"""Ancestry GEDCOM ingest adapter (M2 — personas only, no conclusion resolution).

Reads one GEDCOM export, mints one `person` + `persona` row per INDI record and
one `family_persona` row per FAM record, and records every source citation
(preserving `_APID`) it finds anywhere under that record. Every external id
(the `@I...@` / `@F...@` xref) is stored as an attribute in
`person_external_id` / `*.external_xref` — never as a primary or foreign key,
per docs/build-plan.md §1.5.

Two different GEDCOM exports of overlapping family trees are expected (a
current tree and an older one kept for its own sake) — each import is scoped
to its own `tree_id`, so the same real person legitimately gets one `person`
row per source tree until M4's duplicate-person rule reconciles them. Never
flatten on import (docs/build-plan.md §1.2).

Rows are built in memory with client-generated ids and loaded with `COPY`
(one round trip per table) rather than row-by-row `INSERT ... RETURNING` —
over a high-latency link (e.g. Supabase from a laptop), thousands of
sequential round trips is the difference between seconds and tens of minutes.

Usage:
    uv run python -m ingest.ancestry_gedcom.load <path.ged> <tree_id> <database_url>
"""

from __future__ import annotations

import sys
import uuid
from dataclasses import dataclass

import gedcom_lite as g
import psycopg
from psycopg.types.json import Jsonb

SYSTEM = "ancestry_gedcom"


def new_id() -> str:
    return str(uuid.uuid4())


@dataclass
class CitationRef:
    source_xref: str
    field_path: str
    page: str | None
    data_www: str | None
    raw_apid: str | None
    apid_db_id: str | None
    apid_record_id: str | None


def _text_child(node: g.Structure, tag: str) -> str | None:
    child = node.find(tag)
    return child.text() if child is not None else None


def _split_apid(raw: str | None) -> tuple[str | None, str | None]:
    if not raw:
        return None, None
    # format: "1,<dbId>::<recordId>"
    if "::" in raw:
        db_part, record_part = raw.split("::", 1)
        return db_part, record_part
    return raw, None


def collect_citations(record: g.Structure) -> list[CitationRef]:
    # A single SOUR citation can carry more than one _APID child (Ancestry
    # attaches alternate record matches to the same citation) - one
    # CitationRef per _APID, so none are silently dropped.
    refs = []
    for node in record.walk():
        if node.tag != "SOUR" or not node.payload or not node.payload.startswith("@"):
            continue
        data_node = node.find("DATA")
        www = _text_child(data_node, "WWW") if data_node is not None else None
        page = _text_child(node, "PAGE")
        apid_nodes = node.find_all_children("_APID")
        raw_apids = [a.payload for a in apid_nodes] if apid_nodes else [None]
        for raw_apid in raw_apids:
            db_id, record_id = _split_apid(raw_apid)
            refs.append(
                CitationRef(
                    source_xref=node.payload,
                    field_path=node.path(),
                    page=page,
                    data_www=www,
                    raw_apid=raw_apid,
                    apid_db_id=db_id,
                    apid_record_id=record_id,
                )
            )
    return refs


def _total_apid_count(doc: g.GedcomDocument) -> int:
    return sum(1 for s in doc.all_structures() if s.tag == "_APID")


@dataclass
class Batch:
    repositories: list[tuple] = None
    sources: list[tuple] = None
    persons: list[tuple] = None
    person_external_ids: list[tuple] = None
    personas: list[tuple] = None
    citations: list[tuple] = None
    persona_citations: list[tuple] = None
    family_personas: list[tuple] = None
    family_persona_citations: list[tuple] = None

    def __post_init__(self):
        for f in (
            "repositories",
            "sources",
            "persons",
            "person_external_ids",
            "personas",
            "citations",
            "persona_citations",
            "family_personas",
            "family_persona_citations",
        ):
            if getattr(self, f) is None:
                setattr(self, f, [])


def build_batch(doc: g.GedcomDocument, tree_id: str) -> Batch:
    batch = Batch()

    repo_id_by_xref: dict[str, str] = {}
    for rec in doc.find_records("REPO"):
        rid = new_id()
        repo_id_by_xref[rec.xref] = rid
        batch.repositories.append(
            (rid, SYSTEM, tree_id, rec.xref, _text_child(rec, "NAME") or "", _text_child(rec, "ADDR"))
        )

    source_id_by_xref: dict[str, str] = {}
    for rec in doc.find_records("SOUR"):
        sid = new_id()
        source_id_by_xref[rec.xref] = sid
        raw_apid = _text_child(rec, "_APID")
        db_id, _ = _split_apid(raw_apid)
        repo_node = rec.find("REPO")
        repo_id = repo_id_by_xref.get(repo_node.payload) if repo_node is not None else None
        publ = rec.find("PUBL")
        batch.sources.append(
            (
                sid,
                SYSTEM,
                tree_id,
                rec.xref,
                _text_child(rec, "TITL"),
                _text_child(rec, "AUTH"),
                publ.text() if publ is not None else None,
                _text_child(publ, "DATE") if publ is not None else None,
                _text_child(publ, "PLAC") if publ is not None else None,
                db_id,
                repo_id,
            )
        )

    def add_citations(cites: list[CitationRef], link_id: str, sink: list[tuple]) -> None:
        for cite in cites:
            source_id = source_id_by_xref.get(cite.source_xref)
            if source_id is None:
                continue
            cid = new_id()
            batch.citations.append(
                (cid, source_id, cite.page, cite.data_www, cite.apid_db_id, cite.apid_record_id, cite.raw_apid)
            )
            sink.append((link_id, cid, cite.field_path))

    for rec in doc.find_records("INDI"):
        person_id = new_id()
        batch.persons.append((person_id,))
        batch.person_external_ids.append((new_id(), person_id, "ancestry_pid", rec.xref, tree_id))

        persona_id = new_id()
        sex_node = rec.find("SEX")
        raw = g.structure_to_dict(rec)
        batch.personas.append(
            (
                persona_id,
                person_id,
                SYSTEM,
                tree_id,
                rec.xref,
                sex_node.payload if sex_node is not None else None,
                Jsonb(raw),
            )
        )

        add_citations(collect_citations(rec), persona_id, batch.persona_citations)

    for rec in doc.find_records("FAM"):
        family_persona_id = new_id()
        husb = rec.find("HUSB")
        wife = rec.find("WIFE")
        chil_xrefs = [c.payload for c in rec.find_all_children("CHIL")]
        raw = g.structure_to_dict(rec)
        batch.family_personas.append(
            (
                family_persona_id,
                SYSTEM,
                tree_id,
                rec.xref,
                husb.payload if husb is not None else None,
                wife.payload if wife is not None else None,
                chil_xrefs,
                Jsonb(raw),
            )
        )

        add_citations(collect_citations(rec), family_persona_id, batch.family_persona_citations)

    return batch


def _copy(cur: psycopg.Cursor, table: str, columns: tuple[str, ...], rows: list[tuple]) -> None:
    if not rows:
        return
    col_list = ", ".join(columns)
    with cur.copy(f"COPY {table} ({col_list}) FROM STDIN") as copy:
        for row in rows:
            copy.write_row(row)


def load(path: str, tree_id: str, database_url: str) -> None:
    doc = g.parse(path)
    expected_apids = _total_apid_count(doc)
    batch = build_batch(doc, tree_id)

    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            _copy(
                cur,
                "repository",
                ("id", "system", "tree_id", "external_xref", "name", "addr"),
                batch.repositories,
            )
            _copy(
                cur,
                "source",
                (
                    "id",
                    "system",
                    "tree_id",
                    "external_xref",
                    "title",
                    "author",
                    "publ",
                    "publ_date",
                    "publ_place",
                    "apid_db_id",
                    "repository_id",
                ),
                batch.sources,
            )
            _copy(cur, "person", ("id",), batch.persons)
            _copy(
                cur,
                "person_external_id",
                ("id", "person_id", "system", "value", "tree_id"),
                batch.person_external_ids,
            )
            _copy(
                cur,
                "persona",
                ("id", "person_id", "system", "tree_id", "external_xref", "sex", "raw"),
                batch.personas,
            )
            _copy(
                cur,
                "citation",
                ("id", "source_id", "page", "data_www", "apid_db_id", "apid_record_id", "raw_apid"),
                batch.citations,
            )
            _copy(cur, "persona_citation", ("persona_id", "citation_id", "field_path"), batch.persona_citations)
            _copy(
                cur,
                "family_persona",
                ("id", "system", "tree_id", "external_xref", "husb_xref", "wife_xref", "chil_xrefs", "raw"),
                batch.family_personas,
            )
            _copy(
                cur,
                "family_persona_citation",
                ("family_persona_id", "citation_id", "field_path"),
                batch.family_persona_citations,
            )

            cur.execute(
                """
                select
                    (select count(*) from citation c join source s on s.id = c.source_id
                     where s.tree_id = %s and c.raw_apid is not null)
                    + (select count(*) from source where tree_id = %s and apid_db_id is not null)
                """,
                (tree_id, tree_id),
            )
            (loaded_apids,) = cur.fetchone()
            if loaded_apids != expected_apids:
                raise AssertionError(
                    f"_APID count mismatch for {tree_id}: "
                    f"{expected_apids} in source file, {loaded_apids} loaded"
                )
        conn.commit()


def main(argv: list[str]) -> None:
    path, tree_id, database_url = argv
    load(path, tree_id, database_url)


if __name__ == "__main__":
    main(sys.argv[1:])
