"use client";

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

export default function PersonDetailPage() {
  const session = useRequireSession();
  const params = useParams<{ id: string }>();
  const [persona, setPersona] = useState<Persona | null>(null);
  const [isLiving, setIsLiving] = useState<boolean | null>(null);
  const [names, setNames] = useState<PersonName[]>([]);
  const [citationCount, setCitationCount] = useState<number | null>(null);

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

      const [{ data: privacy }, { data: nameRows }, { count }] = await Promise.all([
        supabase.from("person_privacy").select("is_living").eq("person_id", p.person_id).maybeSingle(),
        supabase.from("person_name").select("id, type, given, surname, preferred").eq("person_id", p.person_id),
        supabase.from("persona_citation").select("*", { count: "exact", head: true }).eq("persona_id", p.id),
      ]);
      setIsLiving(privacy?.is_living ?? null);
      setNames(nameRows ?? []);
      setCitationCount(count ?? 0);
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
          <p className="text-sm text-slate-500">No conclusions recorded yet.</p>
        ) : (
          <ul className="text-sm">
            {names.map((n) => (
              <li key={n.id}>
                {n.type}: {n.given} {n.surname} {n.preferred && "(preferred)"}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
