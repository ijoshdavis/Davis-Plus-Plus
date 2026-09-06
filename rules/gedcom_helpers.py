"""Small accessors over the structure_to_dict() shape stored in persona.raw /
family_persona.raw: {level, tag, xref?, payload?, children: [...]}.
"""

from __future__ import annotations

import re

_YEAR_RE = re.compile(r"(1[4-9]\d{2}|20\d{2})")


def find_child(node: dict, tag: str) -> dict | None:
    for c in node.get("children", []):
        if c["tag"] == tag:
            return c
    return None


def find_children(node: dict, tag: str) -> list[dict]:
    return [c for c in node.get("children", []) if c["tag"] == tag]


def primary_name(raw: dict) -> dict | None:
    return find_child(raw, "NAME")


def givn_surn(name_node: dict) -> tuple[str | None, str | None]:
    givn = find_child(name_node, "GIVN")
    surn = find_child(name_node, "SURN")
    return (givn.get("payload") if givn else None), (surn.get("payload") if surn else None)


def sex(raw: dict) -> str | None:
    node = find_child(raw, "SEX")
    return node.get("payload") if node else None


def birth_year(raw: dict) -> int | None:
    return _event_year(raw, "BIRT")


def death_year(raw: dict) -> int | None:
    return _event_year(raw, "DEAT")


def marriage_year(family_raw: dict) -> int | None:
    return _event_year(family_raw, "MARR")


def _event_year(raw: dict, tag: str) -> int | None:
    event = find_child(raw, tag)
    if not event:
        return None
    date = find_child(event, "DATE")
    if not date or not date.get("payload"):
        return None
    m = _YEAR_RE.search(date["payload"])
    return int(m.group(1)) if m else None


def famc_list(raw: dict) -> list[str]:
    return [c["payload"] for c in find_children(raw, "FAMC") if c.get("payload")]


def fams_list(raw: dict) -> list[str]:
    return [c["payload"] for c in find_children(raw, "FAMS") if c.get("payload")]


def pedi_for_famc(raw: dict, famc_xref: str) -> str | None:
    for c in find_children(raw, "FAMC"):
        if c.get("payload") == famc_xref:
            pedi = find_child(c, "PEDI")
            return pedi.get("payload") if pedi else None
    return None
