from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PersonRecord:
    person_id: str
    external_xref: str
    raw: dict


@dataclass(frozen=True)
class FamilyRecord:
    family_persona_id: str
    external_xref: str
    husb_xref: str | None
    wife_xref: str | None
    chil_xrefs: list[str]
    raw: dict


@dataclass(frozen=True)
class Finding:
    rule: str
    severity: str  # 'error' | 'warning' | 'info'
    subject: dict  # {"person_ids": [...]} and/or {"family_ids": [...]}
    details: dict
    suggested_fix: dict | None = None
