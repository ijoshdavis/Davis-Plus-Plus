# Kinstore

A local-first genealogy system. Postgres holds the truth; Ancestry.com is one
upstream source among many. See `docs/build-plan.md` for the full plan and
`docs/decisions.md` for the running decisions log.

## Status

**M1 (Preserve)** — done for the data side: both raw GEDCOM exports are
committed under `data/raw/ancestry_gedcom/`, unmodified. Installing RootsMagic
11.1.0+ and an off-machine media backup are still manual steps for the owner.

**M2 (Schema + identity spine)** — implemented and live in the real Supabase
project (`uthdjsvpbtlbifkinciq`), verified end-to-end:
- `db/migrations/0001_identity_and_evidence.sql` — identity spine
  (`person`, `person_external_id`) + evidence layer (`repository`, `source`,
  `citation`) + personas (`persona`, `family_persona`), no conclusion layer yet.
- `ingest/ancestry_gedcom/load.py` — parses a GEDCOM export with `gedcom-lite`
  and bulk-loads it as personas via `COPY`. Asserts the loaded `_APID` count
  matches the source file's true count on every run.
- Both trees (Davis++ and Ford-Davis-Tree) are loaded: 3,135 people total,
  931 families, all 268 `_APID` values preserved, zero Ancestry ids used as a
  primary or foreign key anywhere.
- A local Postgres (`docker-compose.yml`) is still available for
  development/testing without touching the live project.

**M3 (GEDCOM round trip)** — export writer built and verified against both
trees from the live Supabase data: re-parsing the exported file reproduces
the same INDI/FAM/SOUR/REPO counts and `_APID` totals as the original, with
zero parse warnings, and re-running the ingest loader's batch-building step
against the exported file matches the original almost exactly (1,565/1,576
Davis++ personas byte-identical; the other 11 differ only in a cosmetic
blank-line marker inside a NOTE — see `docs/decisions.md`). One real, known
gap: the original file's 11 `OBJE` (media) records were never ingested by M2,
so they don't round-trip and affected INDI records will have a dangling
media pointer on import.

**Still manual:** importing `export/output/*.ged` into Gramps and RootsMagic
to check for import errors/warnings — no tool here can drive either app's UI.

**M4 onward** — not started.

## Local development

```sh
uv sync                       # install Python deps
docker compose up -d          # local Postgres on :5488
docker compose exec -T db psql -U postgres -d kinstore < db/migrations/0001_identity_and_evidence.sql

export DATABASE_URL=postgresql://postgres:kinstore@localhost:5488/kinstore
uv run python -m ingest.ancestry_gedcom.load \
  "data/raw/ancestry_gedcom/Davis++ (09-05-26).ged" "Davis++" "$DATABASE_URL"
uv run python -m ingest.ancestry_gedcom.load \
  "data/raw/ancestry_gedcom/Ford-Davis-Tree.ged" "Ford-Davis-Tree" "$DATABASE_URL"
```

(No local `psql` needed — everything runs through the container.)

To run the same steps against the real Supabase project instead, set
`DATABASE_URL` from `.env` (gitignored, holds the Supabase connection string)
rather than the local one. Both `.env` URLs route through the Supavisor pooler
host, never `db.<ref>.supabase.co` directly — matches how the org's other
Vercel/Supabase apps avoid the paid IPv4 add-on; see `docs/decisions.md`. See
also `docs/decisions.md` for why the ingest loader uses `COPY` instead of
row-by-row inserts — it matters a lot over that link.
