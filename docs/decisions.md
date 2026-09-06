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
