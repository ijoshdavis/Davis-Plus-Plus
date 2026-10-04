import { ancestryPersonUrl } from "./ancestry";
import { birthYear, deathYear, primaryName } from "./gedcom";
import { supabase } from "./supabase";
import { DEFAULT_PAGE_SIZE, fetchAllPages } from "./supabasePaging";

export type GraphNode = {
  id: string; // canonical person.id
  name: string;
  birthYear?: number;
  deathYear?: number;
  ancestryUrl: string | null;
  degree: number;
};

export type GraphEdge = {
  source: string;
  target: string;
  kind: "spouse" | "parent-child";
};

export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };

type PersonaRow = { person_id: string; raw: Parameters<typeof primaryName>[0] };
type MembershipRow = { family_persona_id: string; person_id: string | null; role: "husb" | "wife" | "child" };
type ExternalIdRow = { person_id: string; value: string };
type FamilyGroup = { husb: string[]; wife: string[]; child: string[] };

// The graph rarely changes within a session, and re-fetching/re-parsing
// ~3,000 personas plus relationships on every visit to /graph is the main
// reason revisiting the page used to feel like it "rebuilt" from scratch.
// Cached for the lifetime of the page (reset on a hard reload).
let cachedData: Promise<GraphData> | null = null;

export function loadGraphData(): Promise<GraphData> {
  if (!cachedData) cachedData = fetchGraphData();
  return cachedData;
}

async function fetchGraphData(): Promise<GraphData> {
  const [personas, memberships, ancestryIds] = await Promise.all([
    fetchAllPages<PersonaRow>(DEFAULT_PAGE_SIZE, (from, to) =>
      supabase.from("persona").select("person_id, raw").order("person_id").range(from, to)
    ),
    fetchAllPages<MembershipRow>(DEFAULT_PAGE_SIZE, (from, to) =>
      supabase
        .from("family_membership")
        .select("family_persona_id, person_id, role")
        .order("family_persona_id")
        .order("person_id")
        .range(from, to)
    ),
    fetchAllPages<ExternalIdRow>(DEFAULT_PAGE_SIZE, (from, to) =>
      supabase
        .from("person_external_id")
        .select("person_id, value")
        .eq("system", "ancestry_pid")
        .order("person_id")
        .range(from, to)
    ),
  ]);

  const infoByPerson = new Map<string, { name: string; birthYear?: number; deathYear?: number }>();
  for (const p of personas) {
    if (!infoByPerson.has(p.person_id)) {
      infoByPerson.set(p.person_id, {
        name: primaryName(p.raw).display,
        birthYear: birthYear(p.raw),
        deathYear: deathYear(p.raw),
      });
    }
  }

  const ancestryPidByPerson = new Map<string, string>();
  for (const row of ancestryIds) {
    if (!ancestryPidByPerson.has(row.person_id)) ancestryPidByPerson.set(row.person_id, row.value);
  }

  const families = new Map<string, FamilyGroup>();
  for (const m of memberships) {
    if (!m.person_id) continue; // unresolved xref (see resolve_person_id) - no canonical person to link
    let fam = families.get(m.family_persona_id);
    if (!fam) {
      fam = { husb: [], wife: [], child: [] };
      families.set(m.family_persona_id, fam);
    }
    fam[m.role].push(m.person_id);
  }

  const edgeKeys = new Set<string>();
  const edges: GraphEdge[] = [];
  const addEdge = (a: string, b: string, kind: GraphEdge["kind"]) => {
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ source: a, target: b, kind });
  };

  for (const fam of families.values()) {
    const parents = [...fam.husb, ...fam.wife];
    for (let i = 0; i < parents.length; i++) {
      for (let j = i + 1; j < parents.length; j++) addEdge(parents[i], parents[j], "spouse");
    }
    for (const parent of parents) {
      for (const child of fam.child) addEdge(parent, child, "parent-child");
    }
  }

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  const nodes: GraphNode[] = [...infoByPerson.entries()].map(([id, info]) => {
    const pid = ancestryPidByPerson.get(id);
    return {
      id,
      name: info.name,
      birthYear: info.birthYear,
      deathYear: info.deathYear,
      ancestryUrl: pid ? ancestryPersonUrl(pid) : null,
      degree: degree.get(id) ?? 0,
    };
  });

  return { nodes, edges };
}
