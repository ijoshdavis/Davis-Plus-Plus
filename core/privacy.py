"""M5 — computed living/deceased privacy (docs/build-plan.md §5, §6 M5).

is_living = no death date recorded across any of the person's personas, AND
(birth year unknown OR born less than 100 years ago). Conservative by
design: an unknown birth year does not make someone "safe" to show - it
defaults to living, matching the SQL fallback in
db/migrations/0004_privacy_and_roles.sql's is_person_living().

`person_privacy.is_living_override` (nullable) always wins over this - see
that migration - so re-running this never clobbers a manual correction.

Usage:
    uv run python -m core.privacy <database_url>
"""

from __future__ import annotations

import datetime
import sys

import psycopg

from rules import gedcom_helpers as h

LIVING_CUTOFF_YEARS = 100


def compute_is_living(birth_years: list[int], death_years: list[int]) -> bool:
    if death_years:
        return False
    if not birth_years:
        return True
    oldest_birth = min(birth_years)
    return (datetime.date.today().year - oldest_birth) < LIVING_CUTOFF_YEARS


def compute_and_persist(database_url: str) -> int:
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("select person_id, raw from persona")
            by_person: dict[str, list[dict]] = {}
            for person_id, raw in cur.fetchall():
                by_person.setdefault(str(person_id), []).append(raw)

            rows = []
            for person_id, raws in by_person.items():
                birth_years = [y for r in raws if (y := h.birth_year(r)) is not None]
                death_years = [y for r in raws if (y := h.death_year(r)) is not None]
                rows.append((person_id, compute_is_living(birth_years, death_years)))

            # One round trip via a temp table + bulk upsert, not one per
            # person - see docs/decisions.md, the same lesson from the
            # ingest loader's original row-by-row timeout against Supabase.
            cur.execute("create temporary table _person_privacy_staging (person_id uuid, is_living boolean)")
            with cur.copy("COPY _person_privacy_staging (person_id, is_living) FROM STDIN") as copy:
                for row in rows:
                    copy.write_row(row)
            cur.execute(
                """
                insert into person_privacy (person_id, is_living)
                select person_id, is_living from _person_privacy_staging
                on conflict (person_id) do update
                    set is_living = excluded.is_living, computed_at = now()
                """
            )
        conn.commit()
    return len(by_person)


def main(argv: list[str]) -> None:
    (database_url,) = argv
    count = compute_and_persist(database_url)
    print(f"person_privacy computed for {count} people")


if __name__ == "__main__":
    main(sys.argv[1:])
