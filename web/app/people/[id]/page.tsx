"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Nav } from "../../nav";
import { birthYear, deathYear, primaryName, sex } from "@/lib/gedcom";
import { supabase } from "@/lib/supabase";
import { useRequireSession } from "@/lib/useSession";

type Persona = {
  id: string;
  person_id: string;
  tree_id: string;
  external_xref: string;
  raw: Parameters<typeof primaryName>[0];
};

type PersonName = {
  id: string;
  type: string;
  given: string | null;
  surname: string | null;
  preferred: boolean;
};

type FamilyLink = {
  family_persona_id: string;
  role: "husb" | "wife" | "child";
  members: { persona_id: string; role: string; display: string }[];
};

async function loadFamilies(personId: string, treeId: string): Promise<FamilyLink[]> {
  const { data: mine } = await supabase
    .from("family_membership")
    .select("family_persona_id, role")
    .eq("person_id", personId)
    .eq("tree_id", treeId);
  if (!mine || mine.length === 0) return [];

  const familyIds = mine.map((m) => m.family_persona_id);
  const { data: allMembers } = await supabase
    .from("family_membership")
    .select("family_persona_id, person_id, role")
    .in("family_persona_id", familyIds);

  const personIds = [...new Set((allMembers ?? []).map((m) => m.person_id).filter(Boolean))];
  const { data: personas } = await supabase
    .from("persona")
    .select("person_id, id, raw")
    .in("person_id", personIds)
    .eq("tree_id", treeId);
  const nameByPersonId = new Map(
    (personas ?? []).map((p) => [p.person_id, { persona_id: p.id, name: primaryName(p.raw).display }])
  );

  return mine.map((m) => ({
    family_persona_id: m.family_persona_id,
    role: m.role,
    members: (allMembers ?? [])
      .filter((x) => x.family_persona_id === m.family_persona_id && x.person_id !== personId)
      .map((x) => ({
        persona_id: nameByPersonId.get(x.person_id)?.persona_id ?? "",
        role: x.role,
        display: nameByPersonId.get(x.person_id)?.name ?? "(unresolved)",
      })),
  }));
}

export default function PersonDetailPage() {
  const session = useRequireSession();
  const params = useParams<{ id: string }>();
  const [persona, setPersona] = useState<Persona | null>(null);
  const [isLiving, setIsLiving] = useState<boolean | null>(null);
  const [names, setNames] = useState<PersonName[]>([]);
  const [citationCount, setCitationCount] = useState<number | null>(null);
  const [families, setFamilies] = useState<FamilyLink[] | null>(null);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data: p, error } = await supabase
        .from("persona")
        .select("id, person_id, tree_id, external_xref, raw")
        .eq("id", params.id)
        .single();
      if (error || !p) {
        console.error(error);
        return;
      }
      setPersona(p);

      const [{ data: privacy }, { data: nameRows }, { count }, familyLinks] = await Promise.all([
        supabase.from("person_privacy").select("is_living").eq("person_id", p.person_id).maybeSingle(),
        supabase.from("person_name").select("id, type, given, surname, preferred").eq("person_id", p.person_id),
        supabase.from("persona_citation").select("*", { count: "exact", head: true }).eq("persona_id", p.id),
        loadFamilies(p.person_id, p.tree_id),
      ]);
      setIsLiving(privacy?.is_living ?? null);
      setNames(nameRows ?? []);
      setCitationCount(count ?? 0);
      setFamilies(familyLinks);
    })();
  }, [session, params.id]);

  if (!session) return null;
  if (!persona) return (
    <>
      <Nav />
      <main className="mx-auto max-w-2xl p-6 text-slate-500">Loading...</main>
    </>
  );

  const { display } = primaryName(persona.raw);
  const asChild = families?.filter((f) => f.role === "child") ?? [];
  const asSpouse = families?.filter((f) => f.role === "husb" || f.role === "wife") ?? [];

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="mb-1 text-xl font-semibold">{display}</h1>
        <p className="mb-6 text-sm text-slate-500">
          {persona.tree_id} · {persona.external_xref}
        </p>

        <dl className="mb-6 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">Sex</dt>
          <dd>{sex(persona.raw) ?? "unknown"}</dd>
          <dt className="text-slate-500">Born</dt>
          <dd>{birthYear(persona.raw) ?? "unknown"}</dd>
          <dt className="text-slate-500">Died</dt>
          <dd>{deathYear(persona.raw) ?? "unknown"}</dd>
          <dt className="text-slate-500">Status</dt>
          <dd>{isLiving === null ? "unknown" : isLiving ? "Living" : "Deceased"}</dd>
          <dt className="text-slate-500">Citations</dt>
          <dd>{citationCount ?? "..."}</dd>
        </dl>

        <h2 className="mb-2 font-semibold">Conclusions</h2>
        {names.length === 0 ? (
          <p className="mb-6 text-sm text-slate-500">No conclusions recorded yet.</p>
        ) : (
          <ul className="mb-6 text-sm">
            {names.map((n) => (
              <li key={n.id}>
                {n.type}: {n.given} {n.surname} {n.preferred && "(preferred)"}
              </li>
            ))}
          </ul>
        )}

        <h2 className="mb-2 font-semibold">Parents &amp; siblings</h2>
        {!families ? (
          <p className="mb-6 text-sm text-slate-500">Loading...</p>
        ) : asChild.length === 0 ? (
          <p className="mb-6 text-sm text-slate-500">None recorded.</p>
        ) : (
          asChild.map((f) => (
            <FamilyCard key={f.family_persona_id} family={f} />
          ))
        )}

        <h2 className="mb-2 mt-4 font-semibold">Spouse &amp; children</h2>
        {!families ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : asSpouse.length === 0 ? (
          <p className="text-sm text-slate-500">None recorded.</p>
        ) : (
          asSpouse.map((f) => (
            <FamilyCard key={f.family_persona_id} family={f} />
          ))
        )}
      </main>
    </>
  );
}

function FamilyCard({ family }: { family: FamilyLink }) {
  return (
    <Link
      href={`/families/${family.family_persona_id}`}
      className="mb-2 block rounded border p-3 text-sm hover:bg-slate-50"
    >
      {family.members.length === 0 ? (
        <span className="text-slate-500">(no other members recorded)</span>
      ) : (
        family.members.map((m, i) => (
          <span key={m.persona_id || i}>
            {i > 0 && ", "}
            {m.display}
            <span className="text-slate-400"> ({m.role})</span>
          </span>
        ))
      )}
    </Link>
  );
}
