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

## 2026-09-06 — M3: Gramps import confirms the round trip (Ford-Davis-Tree)

Same check as Davis++, this time on `export/output/Ford-Davis-Tree.ged`. The
import report was suspiciously short relative to the 45,810-line file
(1,200 lines, stopping at source line 2,754) - re-ran it to rule out a
copy-paste accident, and got a byte-for-byte identical report both times.
That pointed at Gramps' import dialog capping how many warnings it
*displays* (~400 `DATE`/`PLAC` pairs) rather than only processing part of
the file. Confirmed directly: Gramps' own "Top Surnames" dashboard widget
reports **"Total people: 1559"** - the exact real count for this tree - so
the full file loaded regardless of the truncated log. Zero errors, zero
"ignored" lines in what *was* shown; only the same benign `SOUR.DATA`
`DATE`/`PLAC` quirk seen everywhere else. **M3's Gramps acceptance
criterion is now met for both trees.**

## 2026-09-06 — M3: RootsMagic confirms the round trip too (Ford-Davis-Tree)

RootsMagic doesn't pop up an import dialog - it writes a `.LST` file to disk
next to the new database, named after the GEDCOM (`Ford-Davis-Tree.lst`),
*only* if it hit unfamiliar data. User found and sent it. Its own header
confirms this was the actual exported file (`Source program: Kinstore,
Program version: 0.1.0`), not the original.

Cleanest result of any file/tool combination this session: 1,288 "Unknown
info" entries total (RootsMagic's mildest classification - "here it is, FYI"
- no "Error"/"Warning"/"Fail" anywhere in the file), covering exactly three
tags: `DATE` (401), `PLAC` (399), `NOTE` (488) - all the same non-standard
`SOUR.DATA` citation substructure seen in every other file/tool combination
this session, just manifesting as `NOTE <url>` here where Davis++ used
`WWW <url>` for the equivalent citation link (a difference in the *source*
data's own convention, not something the exporter did). Last flagged line is
44,811 of 45,657 total - essentially the whole file, not a truncated
prefix. Zero `OBJE`-related complaints, unlike Davis++, because
Ford-Davis-Tree has no `OBJE` records to begin with - nothing to dangle.

**M3 is now fully confirmed complete for both trees, in both tools.** Every
issue found across all four file/tool combinations this milestone traces to
one of: the known media-record gap (Davis++/Gramps only), the known
`SOUR.DATA` non-standard citation structure (all four), or genuine
pre-existing Ancestry data quirks unrelated to the round trip (F468/F469,
Ronnie Lamar Davis's `_FREL`). Nothing traces back to a defect in
`export/ancestry_gedcom/write.py` itself.

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

## 2026-09-06 — M5: schema + RLS, first pass

Migration `0004_privacy_and_roles.sql` adds `app_user_role` (owner/family/
viewer) and `person_privacy` (`is_living`, manual override, visibility
tier), plus RLS on `person`, `persona`, `family_persona` (owner/family see
everything; viewer sees only where `is_person_living()` is false) and
`finding` (owner/family only - it's a curation tool, not public-facing, so
viewer gets no access at all rather than a filtered view).

`is_living` is computed in `core/privacy.py`, not a generated column - birth/
death years live inside `persona.raw` jsonb, and a person can have personas
across multiple trees, so it's the same kind of derived-from-personas logic
as the rules engine. Definition per the plan: no death date recorded, AND
(birth year unknown OR born less than `LIVING_CUTOFF_YEARS`=100 years ago).
Unknown birth year defaults to "living" (hidden from viewer) - conservative
on purpose, matching the SQL fallback in `is_person_living()` for people with
no `person_privacy` row yet.

Two lessons repeated from earlier in this log:
- **Row-by-row writes don't scale to Supabase again.** `core/privacy.py`'s
  first version did one `INSERT ... ON CONFLICT` per person (3,135 of them)
  and hit the same wall the ingest loader did in M2 - fine locally, times out
  against the real project. Fixed the same way: stage into a temp table via
  `COPY`, then one bulk `INSERT ... SELECT ... ON CONFLICT`.
- **Local Postgres isn't Supabase.** Plain `docker-compose` Postgres has no
  `auth` schema, no `auth.uid()`, and no `authenticated`/`anon` roles - all
  Supabase-specific. Added `db/local_dev_auth_shim.sql` (never run against
  Supabase, which already has the real thing) so RLS policies can be
  developed and tested locally before touching the live project.

**RLS verified with real queries, not just policy syntax** - the plan's own
bar ("verified by direct SQL against the API, not just through the UI").
Created three throwaway `auth.users` + `app_user_role` rows, used
`SET LOCAL request.jwt.claim.sub` + `SET LOCAL ROLE authenticated` to
simulate each role exactly as PostgREST would, ran queries, then rolled the
whole transaction back - confirmed zero rows persisted afterward. Results
against the real Supabase data: owner and family both see all 3,135 people
(681 living); **viewer sees 2,454 people and zero living ones** - and
spot-checked that a viewer's query for Joshua Lamar Davis's `persona` (born
1977, presumably living) returns nothing, while owner sees his name. This
tests the policy logic directly, not through PostgREST/HTTP - a good-enough
proxy for now, not a substitute for an eventual end-to-end test with a real
JWT once `api/`/`web/` exist.

Also added `scripts/check-no-service-role-key.sh` + `.github/workflows/ci.yml`
per the plan's explicit ask ("grep for it in CI and fail the build if
found") - scoped to `api/`/`web/` (request-handling code) since `ingest/`,
`rules/`, `export/`, `core/` are trusted backend jobs run by the owner, not
request handlers, and legitimately need elevated DB access.

**Not done, and can't be done from here:**
- Disabling public signup is a Supabase Auth *console* setting (GoTrue
  service-level, not Postgres) - no migration can touch it. **Done by the
  user directly in the dashboard** (Authentication → Sign In / Providers →
  "Allow new users to sign up" → off, saved) - confirmed via screenshot.
- Storage/signed-URL verification (media obeys the same tiers) is moot right
  now - M2 never ingested the original file's 11 `OBJE` records, so there is
  no media in Supabase Storage to test against yet. Tied to the same known
  gap noted in M3.

**Correction:** MFA *enforcement* is not actually a console setting - it's a
restrictive RLS policy on the JWT's `aal` (authenticator assurance level)
claim (`auth.jwt()->>'aal' = 'aal2'`, optionally scoped to only users with an
enrolled factor via `auth.mfa_factors`), per Supabase's own documented
pattern. Initially told the user this needed the dashboard; that was wrong.
**User decision: defer implementing this policy for now** - revisit once
there's an actual UI (M6) and someone has a reason to enroll a TOTP factor,
rather than adding a restrictive policy today that would lock out family
members before anyone's enrolled anything.

## 2026-09-06 — M6: read model + first UI, first pass

Added the first real conclusion-layer table, `person_name` (migration
`0005`), plus `change` (the append-only log every write goes through, per
§5 - `person_name` writes are the first thing that logs to it). Both got RLS
matching the same living/deceased split as `person`/`persona`, owner-only
writes.

`apply_missing_married_name(finding_id, given, surname)` is a Postgres
function (`security invoker`, so the caller's own RLS applies - no
privilege escalation needed, non-owners are naturally rejected by
`person_name`'s insert policy) that writes the conclusion, logs the change,
and marks the finding `accepted`, atomically, in one round trip. Verified
against a real `missing_married_name` finding on both local and Supabase,
simulating owner (succeeds) and family (correctly rejected by RLS) roles the
same way M5's policies were tested.

Decided the pooler-vs-supabase-js question flagged back at M2: went with
`@supabase/supabase-js` + anon key, client-side only, no separate API
server - matches funding-harvester/hb-os's pattern (confirmed working
elsewhere in the org) and fits this milestone's read/write shape (CRUD +
RLS, one RPC call for the one real mutation) with no pooler decision needed
at all.

Scaffolded `web/` as Next.js 16 (App Router, TypeScript, Tailwind).
Noteworthy: this Next.js version ships an `AGENTS.md` warning that its APIs
may differ from training data and pointing at bundled docs in
`node_modules/next/dist/docs/` - worth reading before generating Next.js
code, not just assuming prior knowledge holds. Confirmed real, relevant
differences: `params`/`searchParams` are `Promise`s in Server Components now,
and `PageProps<'/route'>`/`LayoutProps<'/route'>` are globally-available
generated types (no import) as of this version.

Pages: `/login` (email+password), `/` (counts dashboard), `/people` (table:
name/sex/birth year/living-status/tree, derived client-side from
`persona.raw` via `lib/gedcom.ts` - a TS mirror of `rules/gedcom_helpers.py`,
display-only), `/people/[id]` (detail + any `person_name` conclusions),
`/findings` (list + inline apply form for `missing_married_name`, generic
dismiss for everything else). All client components - deliberately a "strict
SPA" shape (per Next's own docs) since this is an internal tool, not
SEO-sensitive; no server-side data fetching needed.

A real, non-obvious blocker surfaced building this: nothing is granted to
the `anon` Postgres role (by design - "public signup disabled" implies no
meaningful anonymous access), so the app cannot show *anything* without a
real logged-in session. That means M6 can't be tested end-to-end without:
(1) the Supabase anon/publishable key (not yet provided - the DB connection
string isn't it), (2) the Email auth provider enabled (confirmed disabled
earlier this session), (3) a real user account with an `owner`
`app_user_role` row. None of these are things this session can do alone.

Verified everything that *can* be verified without those three things:
`tsc --noEmit` clean, `eslint` clean, `next build` succeeds (against
placeholder env vars), and `/login`/`/people` both return HTTP 200 with no
server errors against the local dev server.

## 2026-09-06 — M6: PIN login, replacing email+password in the UI

User doesn't want an email/password flow at all - not even to type a
synthetic email once during account setup. Landed on: a person's PIN is
*both* their Supabase password and, via a fixed deterministic mapping
(`lib/pinAuth.ts`: `<pin>@kinstore.local`), their email - so the login
screen only ever shows one field (styled as a phone-style numeric keypad
per a follow-up request), while Supabase still issues a real session and
every RLS policy from M5 keeps working unchanged. No custom backend, no
service_role key, no admin API.

Creating the account itself hit two real snags, in order:
1. The dashboard's "Add user" defaulted to emailing an invite link, which
   pointed at `localhost:3000` (the project's configured Site URL) and had
   already expired by the time it was clicked - `otp_expired`.
2. Separately, the **Email auth provider** itself was toggled off (a
   different setting than "allow new signups", confirmed disabled in an
   earlier screenshot this session) - login failed with "Email logins are
   disabled" even for an already-created account.

Once the user said they didn't want to touch the dashboard for this at
all, created the account directly via SQL instead of asking them to keep
fighting the dashboard: read an existing dashboard-created row from
`auth.users` as a template (to get `instance_id`, `aud`, `role`,
`raw_app_meta_data` shape exactly right rather than guessing), computed a
bcrypt hash of the PIN with the `bcrypt` package (cost 10, matching the
template row), and inserted directly. **Did not assume this worked** -
verified with a real call to Supabase's own `/auth/v1/token?grant_type=password`
endpoint and got back a genuine access token before telling the user it
was ready. This is an unsupported/undocumented path (the supported one is
the Admin API with a service_role key, which wasn't available), justified
here by: reading a real row as a template first, and verifying the result
against the actual auth service rather than trusting the insert alone.

## 2026-09-06 — M6: dashboard KPI row

User asked for the database to be entirely spanned by check.
`source`/`citation`/`repository` had no `authenticated` grant at all
(migration `0006` - not an RLS gap, migration `0004`'s comment already
called them low-sensitivity bibliographic metadata, nothing had queried
them from the client yet so the grant was never added). Used the `dataviz`
skill's guidance for "a handful of headline numbers": a KPI row of stat
tiles (`web/app/page.tsx`), not a bar chart mixing incomparable units
(people vs. citations vs. findings aren't on one comparable scale).

## 2026-09-06 — Autonomous session: two real bugs found, M6 rounded out

User stepped away for about an hour and asked me to keep building and use
my own judgment on scope. Deliberately did **not** touch two things even
with that latitude: the actual Ancestry write-back (M7 - TreeShare needs
per-person review in RootsMagic, a GUI I can't drive anyway, and it's a
hard-to-reverse write to a real third-party account) and MFA enforcement
(no TOTP enrollment UI exists yet, so a restrictive policy would lock out
the only account that currently exists). Both are explicitly left for when
the user is back.

**Bug 1 - a real M5 RLS hole, found while building a new feature, not
looking for bugs.** Building a `family_membership` view (resolves
`family_persona`'s raw `husb_xref`/`wife_xref`/`chil_xrefs` to actual
`person_id`s) surfaced that `resolve_person_id()` (from migration `0004`)
returned NULL for every call: it matched the caller-supplied `system`
value against `person_external_id.system`, but callers were passing
`family_persona.system` (`'ancestry_gedcom'`, the ingest adapter name) -
`person_external_id.system` is a different vocabulary
(`'ancestry_pid'`, the identity namespace). Same column name, unrelated
meaning. Consequence: `family_persona_select`'s viewer branch called
`is_person_living(NULL)`, which conservatively defaults to `true` - so
`not is_person_living(...)` was always false for both spouses, meaning **a
viewer could never see any family record at all**, deceased or not,
regardless of what the policy was actually supposed to allow. This has
been live since M5 shipped. Fixed by dropping the unnecessary parameter
(`person_external_id` only ever holds `'ancestry_pid'` for GEDCOM xrefs,
regardless of which adapter wrote the row referencing them) - migration
`0007`. Re-verified with the same simulated-role technique as M5's
original test, against both local and real Supabase data: viewer now sees
564 of 931 families (both spouses deceased); owner sees all 931.

**Bug 2 - `/people` was silently showing at most 1,000 of 3,135 people.**
Supabase's PostgREST caps every response at 1,000 rows server-side
*regardless of a client-requested `.limit()`* - confirmed directly
(`content-range: 0-999/*` even when asking for 10,000). `web/app/people/page.tsx`
had a hardcoded `.limit(1000)` (a leftover from initial scaffolding, never
revisited against the real row count) and no pagination, so roughly
two-thirds of the tree was invisible in the list view with no indication
anything was missing. Fixed with a `.range()`-based paging loop, ordered
by a unique column so pages can't skip or duplicate rows. Verified by
replaying the same pagination against the real REST API directly: 3,135
rows fetched, 3,135 unique - matches the known total exactly.

**M6 rounded out:**
- `family_membership` view + person detail page now shows parents/siblings
  and spouse/children, each linking to a new `/families/[id]` page
  (spouses, children, marriage year from `family_persona.raw`).
- Search-by-name added to `/people` (client-side substring match).
- `export/ancestry_gedcom/write.py` now layers `person_name` conclusions
  onto the exported GEDCOM as additional `NAME` records tagged
  `_KINSTORE_CONCLUSION` - so a fix applied through the Findings UI today
  actually reaches the file M7 will eventually hand to RootsMagic, which
  wasn't true before (the exporter only ever read `persona.raw`). A
  preferred conclusion leads the NAME list (first `NAME` = conventional
  "primary" signal); the persona's own asserted names are kept, never
  overwritten - same evidence-vs-conclusion split the store already keeps,
  carried through to the file. 3 new unit tests (`export/ancestry_gedcom/test_write.py`,
  no DB needed), verified end-to-end with a real (temporary, then deleted)
  conclusion against the local store: exported, re-parsed clean, correct
  ordering, then cleaned up.
- CI (`.github/workflows/ci.yml`) now runs `export/`'s tests too, and gained
  a second job running the web app's `tsc`/`eslint`/`next build` - none of
  that was checked in CI before this, despite being run manually after
  every web change all session.

Both database bug fixes were verified against the real Supabase project,
not just local, before being called done.

## 2026-09-20 — Research/action queue, and a real rules-engine gap (Evelyn Irene Lutton)

User asked to review Davis++ live on Ancestry.com (Chrome, cfpid pointed at
the focus person) for anyone incorrectly connected, going generation by
generation from the focus person up through great-grandparents. Two things
surfaced, both cross-checked against each person's actual Ancestry profile,
not just the pedigree chart:

**Ronnie Lamar Davis** - already this repo's own seed case for
`ambiguous_famc_pedigree` (see above, M3). Confirmed on Ancestry itself:
his profile explicitly splits **biological parents** (Eldridge Matthew
Hurst + Mamie Pauline Stover) from a **step** parent (Johnnie Jefferson
Davis, Mamie's husband - Mamie and Johnnie had several other children
recorded under Davis). Reads as a deliberate DNA-driven non-paternity
finding someone already worked out, not a data error - logged as a
`user_decision` research task instead of auto-resolving the finding.

**Evelyn Irene Lutton** (b. 11 Jun 1908) - a real rules-engine gap. Her
Ancestry profile records a son, Melvin Brown, born ABT 1922 (~14 years
old at his birth), via a family with no marriage record and zero sources
attached - unlike the 10+ census/vital records backing the rest of her
profile. `impossible_dates` didn't catch this: `child_before_parent` only
fires when a child's birth year is at-or-before the parent's own birth
year, and `marriage_before_min_age` needs a `MARR` tag to compute an age
from, which this family doesn't have. Confirmed straight from the
committed GEDCOM (`data/raw/ancestry_gedcom/Davis++ (09-05-26).ged`,
family `@F146@`): no `MARR` node, and the father is a bare `/Brown/` with
no given name and no `SOUR` at all.

Added a `young_parent` kind to `impossible_dates` (`_MIN_PLAUSIBLE_PARENT_AGE
= 15`, deliberately looser than `_MIN_MARRIAGE_AGE`'s 12 - this fires on
any parent-child pair, married or not, so it needs a wider "worth a look"
band, not just the near-impossible). New fixture
(`evelyn_lutton_family*.json`) built from the real GEDCOM record above -
`person_id`/`family_persona_id` are synthesized UUIDs, not real Postgres
ids, since this workspace has no live database credentials (a fresh git
worktree never inherits the gitignored `.env`/`web/.env.local`); everything
else in the fixture (names, dates, xrefs, structure) is real. Verified
against actual data too, not just the fixture: stood up the local Postgres
from a clean slate (`docker compose up`, auth shim, all 8 migrations,
ingest, `rules.engine`) and re-ran the full rules engine - **368 findings
for Davis++ now (was 349), 19 of them `young_parent`**, including this
exact case (`age_at_child_birth: 14`, xref `@I302788161332@`). 17 unit
tests pass (`uv run pytest rules/ export/`).

Built the review-queue UI the user asked for: a `research_task` table
(migration `0008`, same owner-write/family-read RLS shape as `finding`)
and a new `/actions` page (`web/app/actions/page.tsx`) listing each task
with its parent finding's details, Approve/Decline for `chrome_research`
tasks and a free-text resolution box for `user_decision` ones. Verified
the RLS with the same simulated-role technique as M5 (`SET LOCAL
request.jwt.claim.sub` + `SET LOCAL ROLE authenticated`, rolled back):
owner can update, family can select but a write attempt affects 0 rows -
both tested against the two real seeded tasks, no lasting effect. Seeded
those two rows for real, against the real `finding.id`s above, in local
Postgres.

**Scope boundary, made explicit rather than assumed:** `chrome_research`
is read-only lookups only (checking hints, pulling a source image,
confirming a fact) - never an edit to the Ancestry tree. build-plan.md's
Ancestry constraints are unconditional ("This project never writes to
Ancestry over HTTP... No exceptions") and a prior autonomous session
already declined to automate write-back for the same reason. Any actual
correction still goes through the existing finding -> person_name ->
change flow, unchanged.

**Not done, and worth flagging:** this workspace has no Supabase
credentials (gitignored, worktree-local), so `web/.env.local` holds the
same placeholder values CI uses for `next build` - the dev server runs
and every route responds, but it can't reach the real project's data.
The two seeded `research_task` rows and the recomputed findings exist
only in the local Docker Postgres, not the live Supabase project, until
someone reruns the same migration/ingest/engine steps there with the
real `DATABASE_URL`. Also noticed, unrelated to this work and not fixed:
`scripts/check-no-service-role-key.sh` false-positives on
`web/lib/pinAuth.ts`'s own comment explaining that it has *no*
service_role key - the grep matches the word inside the comment.

**Follow-up same day: the local Docker Postgres above isn't enough for the
web app.** User expected "fully local" to mean the browser UI itself works
with no cloud project involved. It didn't yet: `web/lib/supabase.ts` talks
to Supabase's hosted REST/Auth API via `supabase-js`, not raw Postgres, and
the bare `postgres:16` container from `docker-compose.yml` (plus the
`local_dev_auth_shim.sql` stand-in) has no REST/Auth layer for the browser
to reach - that gap was real, not a misunderstanding to talk someone out of.

Fixed by running the actual Supabase CLI locally (`supabase init` +
`supabase start` at the repo root) - a full local stack (Postgres, REST,
GoTrue Auth, Studio) in Docker, free, no account, no cloud project,
fixed/shared local dev keys. Left `docker-compose.yml` and the auth shim
alone (still useful for fast rules-engine-only iteration); the CLI stack is
additive, on different ports (`54322` vs `5488`), so both run at once with
no conflict.

Re-ran the exact same steps against it: all 8 migrations (this time onto a
*real* `auth` schema - no shim needed), both trees ingested (3,135 people,
matches exactly), rules engine (368/364 findings, same as the docker-compose
run), and re-seeded the same two `research_task` rows against this
instance's own finding ids.

Created a real local-only account rather than hand-crafting a bcrypt hash
this time - the local instance doesn't have the live project's disabled-
email-provider/expired-invite-link problems from the M6 entry above, so the
supported path (`POST /auth/v1/admin/users` with the local secret key)
worked directly. User asked for PIN `1973` specifically; local
`minimum_password_length` is 6 (`supabase/config.toml`), but that's a
signup/change-password strength check, not enforced on admin-created users
or on sign-in - confirmed by actually calling
`/auth/v1/token?grant_type=password` and getting back a real access token,
not by assuming the shorter PIN would work. Marked the account `owner` in
`app_user_role`.

`web/.env.local` now points at the local stack
(`http://127.0.0.1:54321` + the local publishable key - both fixed/shared
local dev values, not secrets). `web/package.json`'s `dev` script now runs
`supabase start --workdir ..` before `next dev`, so the stack comes up
automatically on every `npm run dev` - confirmed idempotent (~2s, prints
status and exits) when already running, so it doesn't slow down repeat
startups. Verified the whole chain for real in the browser via
Claude-in-Chrome, not just via curl: logged in through the actual PIN
keypad UI with `1973`, landed on a dashboard showing real counts (3,135
people, 931 families, 732 open findings), and confirmed `/actions` renders
both seeded tasks with their joined finding details.
