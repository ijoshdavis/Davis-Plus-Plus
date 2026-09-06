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

**Confirmed in Gramps 6.0 (Davis++):** every reported issue maps to an
already-known gap — 11 dangling media pointers (the un-ingested `OBJE`
records) and 2 pre-existing family back-reference quirks that also show up
importing the *original* Ancestry file (proof the relationship data
round-tripped correctly, not a regression). Zero new/unexpected errors.

**Confirmed in RootsMagic (Davis++):** surfaced a real, pre-existing data
ambiguity — Ronnie Lamar Davis has two `FAMC` links (birth father, and his
mother's household) with no standard `PEDI` to say which is biological.
Ancestry uses a non-standard `_FREL step` tag instead, which neither app
understands. Not a round-trip bug; became the seed case for M4's
`ambiguous_famc_pedigree` rule below.

**Still manual/pending:** the same Gramps + RootsMagic checks for
Ford-Davis-Tree — no tool here can drive either app's UI.

**M4 (Rules engine)** — all 6 of the plan's required rules implemented, plus
3 more found live this session (`rules/checks/`): `gender_inconsistency`,
`duplicate_person`, `name_hygiene`, `missing_married_name`,
`duplicate_family`, `impossible_dates` (plan-required), and
`ambiguous_famc_pedigree`, `self_referential_family`, `family_back_reference`
(found investigating real discrepancies this session — see
`docs/decisions.md` for what each caught and why). 16 regression tests
(`rules/test_rules.py`), all passing, nearly all against real fixture data
pulled straight from the store. Run against both trees in Supabase:
**349 findings for Davis++, 345 for Ford-Davis-Tree**. `duplicate_family`
groups by canonical person identity (`rules/dedup.py`), not raw xref, so it
also catches a couple duplicated via two different *person* records (e.g.
"Alax Ford" + "Emily J. Ford" recorded twice via four different xrefs).

**M5 (Auth, RLS, storage)** — schema/RLS half done and verified with real
queries against Supabase (not just policy syntax): `app_user_role` +
`person_privacy` (`core/privacy.py` computes `is_living`), RLS on `person`/
`persona`/`family_persona` (owner+family see everyone; viewer sees only the
deceased) and `finding` (owner+family only, no viewer access). Simulated all
three roles via `SET LOCAL request.jwt.claim.sub` + `SET LOCAL ROLE
authenticated` in a rolled-back transaction: **viewer sees 0 of the 681
living people**, owner/family see all 3,135. Also added
`scripts/check-no-service-role-key.sh` + CI (`.github/workflows/ci.yml`) per
the plan's explicit ask. **Not done, and can't be from here:** enforcing TOTP
MFA and disabling public signup are Supabase *console* settings, not SQL —
needs either you or explicit sign-off to attempt via browser automation.
Storage/signed-URL verification is moot until real media exists (tied to the
M3 media-record gap).

## Local development

```sh
uv sync                       # install Python deps
docker compose up -d          # local Postgres on :5488
docker compose exec -T db psql -U postgres -d kinstore < db/local_dev_auth_shim.sql  # Supabase auth/roles stand-in - local only, never run this against Supabase
for f in db/migrations/*.sql; do docker compose exec -T db psql -U postgres -d kinstore < "$f"; done

export DATABASE_URL=postgresql://postgres:kinstore@localhost:5488/kinstore
uv run python -m ingest.ancestry_gedcom.load \
  "data/raw/ancestry_gedcom/Davis++ (09-05-26).ged" "Davis++" "$DATABASE_URL"
uv run python -m ingest.ancestry_gedcom.load \
  "data/raw/ancestry_gedcom/Ford-Davis-Tree.ged" "Ford-Davis-Tree" "$DATABASE_URL"

uv run python -m rules.engine "Davis++" "$DATABASE_URL"
uv run python -m rules.engine "Ford-Davis-Tree" "$DATABASE_URL"

uv run python -m core.privacy "$DATABASE_URL"
```

(No local `psql` needed — everything runs through the container.)

To run the same steps against the real Supabase project instead, set
`DATABASE_URL` from `.env` (gitignored, holds the Supabase connection string)
rather than the local one. Both `.env` URLs route through the Supavisor pooler
host, never `db.<ref>.supabase.co` directly — matches how the org's other
Vercel/Supabase apps avoid the paid IPv4 add-on; see `docs/decisions.md`. See
also `docs/decisions.md` for why the ingest loader uses `COPY` instead of
row-by-row inserts — it matters a lot over that link.
