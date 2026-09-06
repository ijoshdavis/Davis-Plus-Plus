# Decisions log

## 2026-09-05 — M2 kickoff: real data doesn't match the plan's stated facts

Two Ancestry GEDCOM exports are in hand, not one:

| File | Tree | INDI | FAM | `_APID` |
|---|---|---|---|---|
| `data/raw/ancestry_gedcom/Davis++ (09-05-26).ged` | Davis++ (current, id `212342872`) | 1,576 | 469 | 268 |
| `data/raw/ancestry_gedcom/Ford-Davis-Tree.ged` | Ford-Davis-Tree (older; contains xref `@I34039431903@`, the "pre-migration xref" cited in the build plan) | 1,559 | 462 | 0 |

The build plan's §0 facts table states 462 families and 11,174 `_APID` values for
"the original export." Neither file matches: FAM=462 belongs to Ford-Davis-Tree,
not Davis++, and no export we have contains anywhere near 11,174 `_APID`s (268 +
0 = 268 total). Decision: treat the 11,174 figure as unverified/stale rather
than block on it. M4's regression fixtures should be built from the real
ingested counts, not the plan's §0 table, until a source export with that many
citations turns up.

Both trees are real and both matter: Ford-Davis-Tree is the user's older,
broader tree (kept intentionally, not superseded); Davis++ is the newer
cleaned-and-reuploaded tree. Both were ingested under M2 rather than treating
one as authoritative, per the plan's own "never flatten on import" principle.
Stephanie Lynn Still (the user's wife) is present in both and confirmed loaded
in both (`persona.external_xref` `@I302788161341@` in Davis++, `@I34475987899@`
in Ford-Davis-Tree).

## 2026-09-05 — Supabase project not reachable via MCP; connected directly instead

`uthdjsvpbtlbifkinciq.supabase.co` is not visible to the connected Supabase
MCP integration (different org/account than the one the integration can see),
so M2 was first built and verified against a disposable local Postgres
(`docker-compose.yml`, port 5488). The user then supplied a direct Postgres
connection string; it's stored in `.env` (gitignored, never committed). Both
GEDCOM exports are now loaded into the real project — schema applied from
`db/migrations/0001_identity_and_evidence.sql`, both trees ingested, counts
match the local run exactly (3,135 people, 931 families, 268 `_APID`s).

The first ingest attempt against the remote DB timed out: the original loader
did one `INSERT ... RETURNING` round trip per row (tens of thousands of them
for citations alone), which is fine at near-zero local-Docker latency but
unworkable over the internet. Rewrote `ingest/ancestry_gedcom/load.py` to
generate ids client-side and bulk-load each table with `COPY` — one round
trip per table instead of one per row. Full ingest of both trees now takes
~2 seconds against Supabase. Worth remembering for M3's export writer and any
future bulk-write path: row-by-row execute() does not scale to a remote DB.

## 2026-09-05 — Connection pooling for the eventual Vercel app

The user is deploying the front end (M6/§2) to Vercel, which needs Supavisor's
transaction pooler rather than a direct Postgres connection — serverless scales
out to many short-lived function instances, each wanting its own connection,
which exhausts `max_connections` fast on a direct connection.

The project isn't reachable via the Supabase MCP integration or a local
Supabase CLI token (see above), so there was no API to ask for the pooler
host/region directly. Found it by probing `aws-0-<region>.pooler.supabase.com:6543`
across Supabase's supported regions with the known project ref as username
(`postgres.<ref>`) and the same DB password, until one accepted the connection:
`aws-0-us-east-1`. Confirmed both transaction mode (6543) and session mode
(5432 on the same pooler host) connect and query correctly.

`.env` now has two URLs: `DATABASE_URL` (direct — migrations, admin scripts,
the `ingest/` bulk loaders) and `POOLED_DATABASE_URL` (transaction pooler —
reserved for the Vercel app once `api/`/`web/` exist; nothing consumes it yet).
Whatever DB client `api/` ends up using, disable its client-side prepared
statement cache when using the pooled URL (e.g. Prisma's `?pgbouncer=true`) —
transaction-mode pooling hands out a different physical connection per
transaction, so a statement prepared on one may not exist on the next.

## 2026-09-05 — Matched Kinstore's connection setup to the org's existing convention

The user has ~20 other Vercel projects on the same team (Office of Research /
`ksu-oor`), several already talking to Supabase successfully. Cloned three
(`Waypoint`, `funding-harvester`, `hb-os`) to see what they actually do rather
than guessing:

- **Waypoint** (Next.js + Prisma) never connects to `db.<ref>.supabase.co` at
  all. Both its `DATABASE_URL` (runtime, port 6543, `?pgbouncer=true`) and
  `DIRECT_URL` (Prisma migrations, port 5432) point at the *same* pooler host,
  `aws-0-us-east-1.pooler.supabase.com` — just different ports/modes. This is
  the same pooler host I found by probing regions earlier in this project.
- **funding-harvester** and **hb-os** skip raw Postgres entirely and use
  `@supabase/supabase-js` against the REST API (`SUPABASE_URL` +
  anon/service-role key) — sidesteps the pooler question altogether, at the
  cost of not being able to run arbitrary SQL (no `COPY`, no ad-hoc joins).

The common thread, and the actual answer to "how do I avoid extra cost": the
raw `db.<ref>.supabase.co` host requires either IPv6 or Supabase's paid IPv4
add-on. Every working app in the org avoids that host completely — either by
using the pooler (IPv4-compatible, free, in both session and transaction mode)
or by going through PostgREST over plain HTTPS. Confirmed `COPY` (which the
ingest loader depends on) works fine over the session-mode pooler.

Changed Kinstore's `.env`: `DATABASE_URL` now points at the session-mode
pooler (5432 on the pooler host, was `db.<ref>.supabase.co:5432`) instead of
the raw direct host, and `POOLED_DATABASE_URL` picked up the `?pgbouncer=true`
param Waypoint's `.env.example` calls out as required. Re-ran the full ingest
against the new `DATABASE_URL` — same ~2s runtime, identical counts. This also
makes the ingest portable to IPv4-only environments (CI runners, Vercel Cron)
without ever needing the paid add-on.

If `api/`'s read model ends up needing only CRUD + RLS (no ad-hoc SQL), the
funding-harvester/hb-os pattern (`@supabase/supabase-js` + anon key + user JWT)
is a better fit than a pooled Postgres client — it maps directly onto M5's
owner/family/viewer RLS design and needs no pooler decision at all. Worth
deciding at M6, not before.

## 2026-09-05 — M3: GEDCOM export writer

`export/ancestry_gedcom/write.py` is the inverse of `ingest/ancestry_gedcom/load.py`'s
`build_batch()`: `persona.raw` / `family_persona.raw` already hold a full
`structure_to_dict()` snapshot of the original INDI/FAM record (inline
citations and `_APID` included), so exporting rebuilds `gedcom_lite.Structure`
trees directly from that stored JSON rather than re-deriving GEDCOM from the
normalized conclusion-style tables (which don't exist yet — M2 deliberately
has no conclusion layer). SOUR/REPO records get rebuilt from `source`/
`repository` instead, since those were normalized out of the personas at
ingest time. This required adding `(system, tree_id, external_xref)` to
`repository` (migration `0002`) — it was missing relative to `source`/
`persona`, so a repository's original `@R...@` id couldn't be recovered.

Verified against both trees, from the live Supabase project (not just local):
- Re-parsing the exported file with `gedcom-lite` produces the same INDI/FAM/
  SOUR/REPO counts as the original file, zero parse warnings, and the same
  total `_APID` count (268 for Davis++, 0 for Ford-Davis-Tree).
- Running `ingest.ancestry_gedcom.load.build_batch()` on the exported file
  and comparing it to the same call on the original file: all row counts
  match exactly (persons, personas, citations, family_personas, sources,
  repositories). Persona-by-persona content comparison: 1,565 of 1,576
  Davis++ personas are byte-identical; the other 11 differ only in a blank
  `CONT` line inside a NOTE (a multi-line note's blank paragraph break)
  losing the distinction between "empty string payload" and "no payload" —
  confirmed the reassembled note *text* is identical either way
  (`Structure.text()` matches). Cosmetic, not data loss.

**Known, real gap, not hidden:** the original file's 11 `OBJE` (media object)
records were never ingested by M2 at all — M2's scope was INDI/FAM personas
only. They can't be reconstructed on export, so INDI records that had a
`1 OBJE @O1@` pointer now point at nothing. Gramps/RootsMagic may report a
missing-object warning on import because of this — expected, not a sign the
exporter is broken. Media/OBJE handling isn't scoped until a future milestone
(likely alongside M5's Storage work).

Exported files are at `export/output/*.ged` (gitignored — regenerable, not
source data). Importing them into Gramps and RootsMagic to check for errors/
warnings is a manual step — no tool here can drive either app's UI.

## 2026-09-06 — M3: Gramps import confirms the round trip (Davis++)

User ran the actual exported file (`export/output/Davis++.ged`) through
Gramps 6.0's import. Every reported problem maps to an already-documented,
expected gap — nothing new:

- **11× "OBJE ... not in input GEDCOM"** — the 11 media records M2 never
  ingested (see above). Gramps auto-created placeholder objects rather than
  failing.
- **2× "family ... does not refer back to the family"** (F468/F469) — the
  identical two data-integrity quirks Gramps also found importing the
  *original* Ancestry file directly (checked separately: same two family
  ids, same missing-back-reference shape). Confirms the underlying
  relationship data round-tripped correctly, quirks included — Ancestry's
  own export has this inconsistency, Kinstore didn't introduce or fix it.
- Remaining ~1,700 "ignored"/"skipped" lines are all Ancestry's non-standard
  `SOUR.DATA` substructure (`WWW`/`DATE`/`PLAC`) and inline OBJE-pointer
  crop metadata (`_CROP`/`_LEFT`/`_TOP`/`_WDTH`/`_HGHT`/`_TYPE`) — faithfully
  carried over from `persona.raw`, not introduced by the exporter.
- Zero `_APID` complaints, matching the earlier original-file run (still
  unconfirmed whether Gramps preserves it silently or drops it silently —
  doesn't block M3, since the fidelity check that matters is the DB round
  trip, already verified independently).
- Fewer distinct problem *categories* than importing the original file
  directly (9 vs. ~29) — everything OBJE-internal (`_USER`, `_ENCR`,
  `_MTYPE`, etc.) disappeared along with the OBJE records themselves.

M3's Gramps acceptance criterion is met for Davis++, modulo the documented
media-record gap. Ford-Davis-Tree and RootsMagic still pending.

## 2026-09-06 — M3: RootsMagic surfaces a real ambiguity (Ronnie Lamar Davis)

User imported `export/output/Davis++.ged` into RootsMagic and noticed Ronnie
Lamar Davis's mother wasn't shown, though she appears fine in Gramps.
Investigated: Ronnie has **two** `FAMC` links in the source data - `@F416@`
(father Eldridge Matthew Hurst, no mother) and `@F93@` (Johnnie Jefferson
Davis + Mamie Pauline Stover, married 1933, with Ronnie tagged `_FREL step`
on the FAM's CHIL line). `_FREL` is not a real GEDCOM tag - the standard
mechanism is `PEDI` on the person's own FAMC line - so Ancestry's export
gives no standards-based way to know which family is biological. Gramps and
RootsMagic each resolve that ambiguity differently (Gramps appears to surface
both; RootsMagic appears to only surface one). Confirmed via grep: `_FREL`
appears exactly once in the whole file (this record) and is silently ignored
by both apps' import logs - not a round-trip bug, a pre-existing Ancestry
data-modeling gap. Became the seed case for the `ambiguous_famc_pedigree`
rule below.

## 2026-09-06 — M4: rules engine, first pass

Added `finding` table (migration `0003`) and `rules/engine.py`, which loads
personas/families for a tree from the M2 store and runs a set of checks.
Findings are recomputed from scratch each run (old rows for that rule+tree
deleted first) - the store is the source of truth, not the finding table.
Rules are plain functions over `PersonRecord`/`FamilyRecord` lists (no DB
dependency), so they're unit-testable against fixtures pulled straight from
real data - `rules/test_rules.py`, 8 tests, all passing.

Five rules implemented so far, two from the plan's required list and three
found live this session:

- **`gender_inconsistency`** (plan-required) — uses `gender-guesser` (added
  as a dependency), only flags a *confident* male/female guess that
  disagrees with recorded sex (mirrors the plan's "strongly disagrees").
  Catches Hezekiah Herring (`@I302788162351@`, recorded `SEX F`).
- **`duplicate_person`** (plan-required) — same normalized name within a
  tree, clustered by birth-year compatibility (union-find; an unknown year
  is compatible with anything, including another unknown - needed to catch
  the fixture case, since neither Lizzie Renfroe record has a birth year).
  Catches both `@I302788162034@` / `@I302788162038@` "Lizzie Renfroe".
- **`ambiguous_famc_pedigree`** (not in the plan; found this session) —
  person with 2+ `FAMC` and no `PEDI` disambiguating at least one. Catches
  Ronnie Lamar Davis, see above.
- **`self_referential_family`** (not in the plan; found this session) — a
  family's `HUSB` and `WIFE` are the *same person*. Found by inspecting why
  `family_back_reference` fired twice for the same person+family: families
  `@F468@`/`@F469@` both list one person (George W Mayo for `@F468@`) as
  both spouses. Ancestry tags these `_SREL unknown` - even its own matching
  flagged uncertainty. More severe and clearer than a missing back-reference,
  so it's its own rule rather than folded into that one.
- **`family_back_reference`** (not in the plan; found via Gramps' own
  auto-repair on the original file import, M3) — a family's `HUSB`/`WIFE`
  doesn't have a matching `FAMS` pointer back. Gramps silently self-heals
  this on import; this rule surfaces it as a reviewable finding instead.

Run against the real Supabase data: Davis++ has 91 findings across 5 rules,
Ford-Davis-Tree has 86 across 3 (no `family_back_reference` or
`self_referential_family` hits - those two specific bad records are only in
the newer tree).

**Not yet built**, still required by the plan: **name hygiene**, **missing
married name**, **duplicate family**, **impossible dates**. The plan's own
target numbers for these (145 married names, 25 damaged names) are subject
to the same stale-data caveat as the 11,174 `_APID` figure - real numbers
from the real store will replace them once built.

## 2026-09-06 — M4: remaining four required rules

Added the last four rules from the plan's minimum list, all verified against
real specimens found in one or the other tree (not synthetic):

- **`name_hygiene`** — five sub-checks (`kind` in `details`), each with a
  confirmed real hit: `parenthetical_in_surname` ("Alice Jane /(Hardin)
  Aaron/", the plan's own example, `@I302788161946@`),
  `research_annotation_in_surname` ("Bolton(4GGF)", "McWhorter 3rd ggf"),
  `suffix_in_surname` ("Smith Jr.", "Edney Sr"), `unbalanced_quotes`, and
  `empty_surname`. The last two don't exist in Davis++ but do in
  Ford-Davis-Tree: `Evelyn Irene "Eva" Evie" /Young/` (`@I34039528489@`,
  three quote chars - the plan's own "Evelyn Irene" example, just from the
  older tree) and `Susannah //` (`@I_CL016@`) - whose own NOTE says
  `[Added by Claude research, 3 Sep 2026] ... maiden name unknown`, i.e. a
  prior AI-assisted research pass already flagged this one manually. Good
  confirmation that the rule is finding real gaps, not noise.
- **`missing_married_name`** — no explicit birth/married name typing exists
  in this data, so the signal is: a documented marriage (`FAMS` with `MARR`)
  but every `NAME` record on file shares one surname. Scored 0-4 per the
  plan's own criteria (born >1850, died >1935, marriage documented, has any
  source). Mamie Pauline Stover (Ronnie Lamar Davis's mother, `@F93@` from
  earlier) is a top-scored hit - fittingly, since her married-name situation
  is exactly what's ambiguous in that whole case.
- **`duplicate_family`** — groups families by the unordered `{husb_xref,
  wife_xref}` pair; >1 family per pair is the finding, marriage-date
  proximity reported as corroboration, not a filter. **Zero real hits in
  either tree** - confirmed directly against the store (no repeated exact
  xref-pair exists). This is a narrower definition than "the same real
  couple duplicated via two different *person* records" (which would need
  joining against `duplicate_person`'s output) - noted as a gap, not
  papered over. Regression test uses a synthetic second family for the
  negative case since no real positive specimen exists.
- **`impossible_dates`** — three `kind`s: `death_before_birth`,
  `marriage_before_min_age` (<12), `child_before_parent`. Spot-checked
  the marriage-age findings; several are marriages at ages 2, 8, 9, 10 -
  clearly bad records, not edge cases. 18-19 findings per tree.

Full run against Supabase, all 9 rules: **342 findings for Davis++, 339 for
Ford-Davis-Tree**. 15 regression tests total, all against real fixture data
except the one noted synthetic case, all passing.

**M4's plan-required rule list is now fully implemented.** The plan's own
target figures (145 married names, 25 damaged names) don't match what came
out (191/190 married-name candidates, 42/44 name-hygiene findings) - expected
per the stale-data findings earlier in this log; real numbers now stand in
their place as the regression baseline.

## 2026-09-06 — Closed the duplicate_family gap

`duplicate_family` originally grouped by the literal `(husb_xref, wife_xref)`
pair and found zero real hits - too narrow, since the same couple can be
duplicated via two different *person* records rather than one repeated
family record. Extracted the clustering logic from `duplicate_person` into
`rules/dedup.py` (`canonical_xref_map`) and had `duplicate_family` group
families by their spouses' canonical cluster instead of raw xref.

Real result: 7 hits in Davis++ (up from 0), 6 in Ford-Davis-Tree, all
`via_duplicate_person: true` - confirming this was a real, closed gap, not a
false alarm. Best example: "Alax Ford" + "Emily J. Ford" recorded as a couple
twice (`@F44@`, `@F59@`) via four entirely different xrefs - both spouses are
themselves duplicate-person records, so this was unreachable by any xref-based
matching alone. `duplicate_person` was refactored to use the same shared
clustering (no behavior change, just deduplicated logic) rather than
maintaining two copies of the same algorithm.

Full re-run against Supabase, all 9 rules: **349 findings for Davis++, 345
for Ford-Davis-Tree**. 16 regression tests, all passing.

## 2026-09-05 — Ingest bug found and fixed: multiple `_APID` per citation

A handful of `SOUR` citations in Davis++ carry more than one `_APID` child
(Ancestry attaching alternate record matches to the same citation, e.g. 2-3
newspaper record ids under one "U.S. School Yearbooks" citation). The first
version of `ingest/ancestry_gedcom/load.py` used `.find()` (first-match) and
silently dropped 9 of 268 `_APID`s. Fixed by iterating `find_all_children`
and emitting one citation row per `_APID`. `load()` now asserts the loaded
`_APID` count against the source file's true count on every ingest run, so a
future regression fails loudly instead of silently — this was exactly the
"lossy parser silently eats these" risk the build plan calls out in §0 and §7,
just manifesting in adapter code rather than the parsing library.
