"""Regression test for M6 conclusion export - no DB needed, pure Structure
manipulation. Run: uv run pytest export/
"""

from __future__ import annotations

import gedcom_lite as g

from export.ancestry_gedcom.write import _add_conclusion_name, structure_from_dict


def _sample_indi() -> g.Structure:
    return structure_from_dict(
        {
            "level": 0,
            "tag": "INDI",
            "xref": "@I1@",
            "children": [
                {
                    "level": 1,
                    "tag": "NAME",
                    "payload": "Jane /Smith/",
                    "children": [
                        {"level": 2, "tag": "GIVN", "payload": "Jane"},
                        {"level": 2, "tag": "SURN", "payload": "Smith"},
                    ],
                },
                {"level": 1, "tag": "SEX", "payload": "F"},
            ],
        }
    )


def test_preferred_conclusion_leads_the_name_list():
    indi = _sample_indi()
    _add_conclusion_name(
        indi, {"given": "Jane", "surname": "Jones", "suffix": None, "preferred": True, "type": "married"}
    )
    names = indi.find_all_children("NAME")
    assert [n.payload for n in names] == ["Jane /Jones/", "Jane /Smith/"]


def test_conclusion_is_tagged_and_round_trips_clean():
    indi = _sample_indi()
    _add_conclusion_name(
        indi, {"given": "Jane", "surname": "Jones", "suffix": None, "preferred": False, "type": "married"}
    )
    names = indi.find_all_children("NAME")
    assert [n.payload for n in names] == ["Jane /Smith/", "Jane /Jones/"]
    concluded = names[1]
    assert concluded.find("_KINSTORE_CONCLUSION").payload == "married"

    doc = g.GedcomDocument.parse(b"0 HEAD\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n0 TRLR\n")
    doc.records.append(indi)
    reparsed = g.GedcomDocument.parse(doc.write())
    assert reparsed.parse_warnings == []
    assert [n.payload for n in reparsed.resolve("@I1@").find_all_children("NAME")] == [
        "Jane /Smith/",
        "Jane /Jones/",
    ]


def test_suffix_is_included_when_present():
    indi = _sample_indi()
    _add_conclusion_name(
        indi, {"given": "Jane", "surname": "Smith", "suffix": "Jr.", "preferred": False, "type": "aka"}
    )
    concluded = indi.find_all_children("NAME")[1]
    assert concluded.find("NSFX").payload == "Jr."
