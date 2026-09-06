# Kinstore — Build Plan

A local-first genealogy system. Postgres holds the truth; Ancestry.com is demoted to one
upstream source among many. Authenticated access with MFA, tiered visibility, and a
periodic public-safe static snapshot for durability.

This document is the brief. Each milestone below is sized for one agent working in one
branch, with explicit acceptance criteria. Do not start a milestone whose predecessor's
acceptance criteria have not been met.

---

## 0. Context you need before writing code

The subject tree is **Davis++** on Ancestry (tree id `212342872`, ~1,576 people,
462 families). It was created by uploading a cleaned GEDCOM on 2026-09-03. Facts
established by prior analysis that this build depends on:

| Fact | Value | Why it matters |
|---|---|---|
| Ancestry person id | `302788161318` | Current tree. Deep-links to profile. **Reassigned on every re-upload.** |
| Pre-migration xref | `@I34039431903@` | The id in the pre-2026-09-03 export. Bridge to older derived data. |
| Citation pointer | `_APID 1,1265::53952613` | `1,<dbId>::<recordId>`. 11,174 present in the original export. Reconstructs the Ancestry record URL. **A lossy parser will silently eat these.** |
| Known defects | 145 missing married names, 25 with damaged name fields, ≥1 duplicate person (Lizzie Renfroe), duplicate family records, ≥1 gender error (Hezekiah Herring flagged F) | The rules engine must find all of these from the store alone. |

**Ancestry constraints that are not negotiable:**

- A GEDCOM upload always creates a **new** tree. There is no import-into-existing.
  The only sanctioned write path to an existing tree is RootsMagic TreeShare or
  Family Tree Maker FamilySync. RootsMagic **11.1.0+** is required — earlier versions
  lose Ancestry access when the legacy API is retired.
- Ancestry's Terms §1.3 prohibit programmatic access "that exceeds the intended standard
  human use," and §4 permits account termination. **This project never writes to
  Ancestry over HTTP.** Export → RootsMagic → TreeShare is the only write path.
  No exceptions, no "just this once," no rate-limited loops.

---

## 1. Principles

1. **Ancestry is a source, not a peer.** Nothing Ancestry-specific leaks into the core
   schema. An Ancestry import is one implementation of a generic source ingester.
2. **Personas before persons.** Store what each source *says* separately from what you
   *conclude*. Never flatten on import — that decision cannot be undone later.
3. **Append-only.** Changes are events, not mutations. Re-import must be replayable,
   diffable and reversible.
4. **Privacy in the database.** Living-person rules live in RLS, not in view code, so
   every future front end inherits them.
5. **Own the identity.** Local ids are the only primary keys. Every foreign id is an
   attribute.
6. **Durability outranks features.** If the app dies, the data must still be readable.

---

## 2. Stack

- **Postgres** via Supabase (auth, RLS, storage) — already in use by the owner.
- **Python 3.12** for ingest, rules engine, export. Runs on Railway or as jobs.
- **TypeScript / React** front end on Vercel.
- **Gramps** desktop installed locally as an *independent validator only*. Never a UI.

---

## 3. Dependencies

### Adopt as libraries

| Package | Repo | Role |
|---|---|---|
| gedcom-lite | https://github.com/vaelen/gedcom-lite | **Primary parser/writer.** Fidelity-preserving; covers 5.5.1, 5.5.5 and GEDCOM 7. Fidelity preservation is the requirement — it must not drop `_APID`. Verify this with a test before committing to it. |
| python-gedcom7 | https://github.com/DavidMStraub/python-gedcom7 | GEDCOM 7 parsing if the internal canonical form is 7. Same author as Gramps Web API. |
| gedcomtools | https://github.com/cartwrightdj/gedcomtools | Fallback/cross-check parser and validator. Useful as a second opinion in tests. |
| d3-hierarchy | https://github.com/d3/d3-hierarchy | Pedigree and descendant layouts. |
| d3-dag | https://github.com/erikbrinkman/d3-dag | **Required, not optional.** A deep Georgia tree will contain pedigree collapse; the ancestor graph is a DAG, not a tree, and d3-hierarchy alone will render it wrong. |
| sigma.js | https://github.com/jacomyal/sigma.js | Large-graph exploration view. |
| graphology | https://github.com/graphology/graphology | Graph model behind sigma; also useful server-side for cycle and duplicate detection. |
| cytoscape.js | https://github.com/cytoscape/cytoscape.js | Alternative graph view — evaluate against sigma, pick one, delete the other. |
| Observable Plot | https://github.com/observablehq/plot | Analytical charts: birth-year distribution, source coverage, lifespan. |
| MapLibre GL JS | https://github.com/maplibre/maplibre-gl-js | Migration maps. Open source, no access token. |

### Reference, do not vendor

| Source | Link | Use |
|---|---|---|
| FamilySearch GEDCOM 7 spec | https://gedcom.io/specifications/FamilySearchGEDCOMv7.html · repo https://github.com/FamilySearch/GEDCOM | Canonical grammar, especially the **date grammar** (`ABT`, `BET`/`AND`, `EST`, `CAL`, date phrases). Implement this properly once; 684 non-conformant dates existed in the source data. |
| GEDCOM extension registry | https://github.com/FamilySearch/GEDCOM-registries | Correct way to register your own extensions instead of inventing `_TAGS`. |
| GEDCOM X | https://github.com/FamilySearch/gedcomx-rs | **The persona/conclusion model.** Read this before designing tables. |
| Gramps | https://github.com/gramps-project/gramps | Reference object model: source vs. citation vs. repository, place hierarchies, alternate names as objects. |
| Gramps Web API | https://github.com/gramps-project/gramps-web-api | Reference REST design for a genealogy read model. Read the API shape; do not adopt the app. |
| webtrees | https://github.com/fisharebest/webtrees | Reference for privacy tiers — its living-person and role logic is mature and worth reading before writing RLS. |

---

## 4. Repository layout

```
kinstore/
  db/           migrations, RLS policies, seed
  ingest/       source adapters (ancestry_gedcom, generic_gedcom, manual)
  core/         persona→person resolution, change log, provenance
  rules/        audit rules + fixtures
  export/       GEDCOM 5.5.1 writer (RootsMagic-compatible), snapshot builder
  api/          read model
  web/          front end
  snapshot/     static export template
  docs/         this plan, decisions log, schema notes
```

---

## 5. Data model

Sketch, not final DDL. Agent implementing M2 owns the details.

**Identity**
- `person` — `id` (local, stable, never derived from any external id), `created_at`
- `person_external_id` — `person_id`, `system` (`ancestry_pid`, `legacy_xref`, `fs_id`…),
  `value`, `tree_id`, `first_seen`, `last_seen`. Many per person. Nothing cascades on change.

**Evidence layer**
- `source` — a record collection or document
- `citation` — a specific record within a source; carries `apid_db_id`, `apid_record_id`
- `persona` — one person *as described by one citation*: names, dates, places, relationships
  as asserted. Immutable once written.

**Conclusion layer**
- `person_name` — `person_id`, `type` (birth / married / aka / nickname), `given`, `surname`,
  `suffix`, `preferred`. Alternate names are rows, not a text field.
- `event`, `event_participant`, `place`, `family`, `relationship`
- `conclusion_evidence` — joins each conclusion field to the personas supporting it
- `conflict` — where personas disagree. **Recorded, not resolved away.**

**Change log**
- `change` — append-only: `entity`, `entity_id`, `field`, `old`, `new`, `actor`, `source`,
  `occurred_at`. Every write goes through this. No exceptions; a mutation that bypasses the
  log is a bug.

**Access**
- `person_privacy` — computed: `is_living` (no death date AND born < 100 years ago, with a
  manual override column), `visibility_tier`
- `app_user_role` — `owner` / `family` / `viewer`

---

## 6. Milestones

### M1 — Preserve (do this first, today)
Not code. Blocks everything.
1. Export Davis++ from Tree settings → Export tree. Keep the raw file. **Do not clean it.**
2. Install RootsMagic 11.1.0+; download Davis++ with citation media enabled.
3. Back up the local file and media folder off-machine.

**Accept:** the local copy opens offline and displays a census image.

---

### M2 — Schema + identity spine
Implement §5 as migrations. Import the M1 GEDCOM as personas only — no conclusion
resolution yet. Populate `person_external_id` with `ancestry_pid` and `legacy_xref`.

**Accept:**
- All ~1,576 people resolve to a local id.
- 11,174 `_APID` values are stored as structured `apid_db_id` / `apid_record_id`.
- A randomly chosen citation reconstructs a URL that opens the correct Ancestry record.
- Zero rows anywhere use an Ancestry id as a primary or foreign key.

---

### M3 — GEDCOM round trip
Ingest and export, both directions, with the date grammar implemented per the GEDCOM 7 spec.

**Accept:**
- `import → export → import` is idempotent: second import produces zero changes.
- No `_APID` is lost in the round trip (assert on the count: 11,174).
- The exported 5.5.1 file imports into **Gramps** with zero errors — Gramps is the
  independent oracle here, and this is the whole point of installing it.
- The exported file imports into RootsMagic without warnings.

---

### M4 — Rules engine
Audit rules over the store. Each rule returns findings with severity, affected person ids,
and a suggested fix. Rules are data-driven and individually testable.

Required rules at minimum:
- **Name hygiene** — parentheticals (`Alice Jane (Hardin) Aaron`), nicknames inside given
  names, unbalanced quotes (`Evelyn Irene "Eva" Evie"`), research annotations in surname
  fields (`Britton (18th GGF)`, `McWhorter 3rd ggf`), suffixes in surname (`Smith Jr.`),
  empty surnames.
- **Missing married name** — women with a documented marriage and no married-name row,
  scored on likelihood of earning record matches (lived past 1850; died after 1935;
  marriage documented; sources attached).
- **Gender inconsistency** — given name strongly disagrees with recorded sex.
- **Duplicate person** — same name + birth year; near-identical names sharing parents.
- **Duplicate family** — same couple recorded more than once; marriage dates within a few
  days of each other.
- **Impossible dates** — child before parent, death before birth, marriage before age 12.

**Accept:** running against the M2 store reproduces the known figures — **145** clean
married-name candidates, **25** flagged for damaged name fields — and finds the Lizzie
Renfroe duplicate, the duplicate marriage records, and the Hezekiah Herring gender error.
These are regression fixtures; commit them as tests.

---

### M5 — Auth, RLS, storage
Supabase Auth with TOTP MFA. **Public signup disabled — invite/allowlist only.**

RLS policies by role:
- `owner` — everything
- `family` — living people visible
- `viewer` — deceased only

**Accept:**
- A `viewer` JWT querying `person` cannot see any living person, verified by direct SQL
  against the API, not just through the UI.
- Media in Supabase Storage is served by **signed URL** and obeys the same tiers. Verify by
  attempting to fetch a living person's photo with a `viewer` token — it must fail. An
  open media bucket makes every policy above decorative.
- Server-side calls use the caller's JWT. **The service role key must not appear anywhere
  in request-handling code paths** — grep for it in CI and fail the build if found.

---

### M6 — Read model + first front end
Freeze a query API — people, relationships, events, places, citations, findings — and build
against it. First UI is a **plain table view plus a person detail page**. No tree diagram.

**Accept:** every finding from M4 is reviewable and fixable in the UI, and each fix writes a
`change` row. The 145 married names can be applied from here.

---

### M7 — Write-back to Ancestry
Export the corrected tree as 5.5.1 → RootsMagic → TreeShare → Davis++, with per-person
review in RootsMagic.

**Accept:** push five people first and confirm the Also Known As appears on ancestry.com
before pushing the remaining 140.

---

### M8 — Visualization
Now the fun part, and only now. Pedigree via d3-dag (handles pedigree collapse), graph
exploration via sigma, analytics via Observable Plot, migration map via MapLibre.

**Accept:** a person with duplicated ancestors renders correctly rather than silently
duplicating subtrees.

---

### M9 — Durability snapshot
Static export: deceased-only, no auth, no database, self-contained and openable from a
folder. Scheduled monthly, archived off-site.

**Accept:** unzip on a machine with no network and browse the tree.

---

## 7. Things that will go wrong

- **Reconciliation drift** — both sides edited, no rule for who wins. This is what kills
  projects like this. Mitigation: for v1 Ancestry is **read-only into** the system;
  write-back is a one-directional publish, never a merge.
- **The front end eats the schedule.** M8 is deliberately last. A tree viewer is weeks of
  work that improves data quality by zero.
- **A lossy parser.** Test `_APID` survival before building on any library.
- **Living-person leakage through media.** The most likely real-world privacy failure is an
  unsigned storage URL, not a bad SQL policy.
- **RootsMagic 11 friction.** Its own community reports TreeShare problems post-upgrade.
  Test with three people before trusting it with 145.

---

## 8. Out of scope

Do not build: a GEDCOM parser from scratch; a bespoke data model not derived from GEDCOM X
and Gramps; any HTTP client that writes to ancestry.com; DNA matching; OCR.
