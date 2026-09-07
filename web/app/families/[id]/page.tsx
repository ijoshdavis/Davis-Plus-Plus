"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Nav } from "../../nav";
import { marriageYear, primaryName } from "@/lib/gedcom";
import { supabase } from "@/lib/supabase";
import { useRequireSession } from "@/lib/useSession";

type FamilyPersona = {
  id: string;
  tree_id: string;
  external_xref: string;
  raw: Parameters<typeof marriageYear>[0];
};

type Member = { persona_id: string; role: string; display: string };

export default function FamilyDetailPage() {
  const session = useRequireSession();
  const params = useParams<{ id: string }>();
  const [family, setFamily] = useState<FamilyPersona | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data: fam, error } = await supabase
        .from("family_persona")
        .select("id, tree_id, external_xref, raw")
        .eq("id", params.id)
        .single();
      if (error || !fam) {
        console.error(error);
        return;
      }
      setFamily(fam);

      const { data: rows } = await supabase
        .from("family_membership")
        .select("person_id, role")
        .eq("family_persona_id", fam.id);
      const personIds = [...new Set((rows ?? []).map((r) => r.person_id).filter(Boolean))];
      const { data: personas } = await supabase
        .from("persona")
        .select("person_id, id, raw")
        .in("person_id", personIds)
        .eq("tree_id", fam.tree_id);
      const byPersonId = new Map(
        (personas ?? []).map((p) => [p.person_id, { persona_id: p.id, name: primaryName(p.raw).display }])
      );
      setMembers(
        (rows ?? []).map((r) => ({
          persona_id: byPersonId.get(r.person_id)?.persona_id ?? "",
          role: r.role,
          display: byPersonId.get(r.person_id)?.name ?? "(unresolved)",
        }))
      );
    })();
  }, [session, params.id]);

  if (!session) return null;
  if (!family) return (
    <>
      <Nav />
      <main className="mx-auto max-w-2xl p-6 text-slate-500">Loading...</main>
    </>
  );

  const spouses = members?.filter((m) => m.role === "husb" || m.role === "wife") ?? [];
  const children = members?.filter((m) => m.role === "child") ?? [];

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="mb-1 text-xl font-semibold">
          {spouses.length > 0 ? spouses.map((s) => s.display).join(" & ") : "Family"}
        </h1>
        <p className="mb-6 text-sm text-slate-500">
          {family.tree_id} · {family.external_xref}
          {marriageYear(family.raw) && ` · married ${marriageYear(family.raw)}`}
        </p>

        <h2 className="mb-2 font-semibold">Spouses</h2>
        {!members ? (
          <p className="mb-6 text-sm text-slate-500">Loading...</p>
        ) : spouses.length === 0 ? (
          <p className="mb-6 text-sm text-slate-500">None recorded.</p>
        ) : (
          <ul className="mb-6 text-sm">
            {spouses.map((m) => (
              <MemberLink key={m.persona_id} member={m} />
            ))}
          </ul>
        )}

        <h2 className="mb-2 font-semibold">Children</h2>
        {!members ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : children.length === 0 ? (
          <p className="text-sm text-slate-500">None recorded.</p>
        ) : (
          <ul className="text-sm">
            {children.map((m) => (
              <MemberLink key={m.persona_id} member={m} />
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

function MemberLink({ member }: { member: Member }) {
  if (!member.persona_id) {
    return <li className="text-slate-500">{member.display}</li>;
  }
  return (
    <li>
      <Link href={`/people/${member.persona_id}`} className="text-blue-700 hover:underline">
        {member.display}
      </Link>
    </li>
  );
}
