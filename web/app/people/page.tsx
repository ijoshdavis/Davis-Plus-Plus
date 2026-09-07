"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Nav } from "../nav";
import { birthYear, primaryName, sex } from "@/lib/gedcom";
import { supabase } from "@/lib/supabase";
import { useRequireSession } from "@/lib/useSession";

type Row = {
  id: string;
  person_id: string;
  tree_id: string;
  external_xref: string;
  raw: object;
  is_living: boolean | null;
};

export default function PeoplePage() {
  const session = useRequireSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [treeFilter, setTreeFilter] = useState<string>("");

  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data: personas, error } = await supabase
        .from("persona")
        .select("id, person_id, tree_id, external_xref, raw")
        .order("tree_id")
        .limit(1000);
      if (error || !personas) {
        console.error(error);
        return;
      }

      const personIds = [...new Set(personas.map((p) => p.person_id))];
      const { data: privacy } = await supabase
        .from("person_privacy")
        .select("person_id, is_living")
        .in("person_id", personIds);
      const livingByPerson = new Map(privacy?.map((p) => [p.person_id, p.is_living]) ?? []);

      setRows(
        personas.map((p) => ({ ...p, is_living: livingByPerson.get(p.person_id) ?? null }))
      );
    })();
  }, [session]);

  if (!session) return null;

  const trees = rows ? [...new Set(rows.map((r) => r.tree_id))] : [];
  const filtered = treeFilter ? rows?.filter((r) => r.tree_id === treeFilter) : rows;

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-4xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">People</h1>
          <select
            value={treeFilter}
            onChange={(e) => setTreeFilter(e.target.value)}
            className="rounded border px-2 py-1 text-sm"
          >
            <option value="">All trees</option>
            {trees.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        {!filtered ? (
          <p className="text-slate-500">Loading...</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-500">
                <th className="py-2">Name</th>
                <th>Sex</th>
                <th>Born</th>
                <th>Status</th>
                <th>Tree</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const raw = row.raw as Parameters<typeof primaryName>[0];
                return (
                  <tr key={row.id} className="border-b hover:bg-slate-50">
                    <td className="py-2">
                      <Link href={`/people/${row.id}`} className="text-blue-700 hover:underline">
                        {primaryName(raw).display}
                      </Link>
                    </td>
                    <td>{sex(raw) ?? "?"}</td>
                    <td>{birthYear(raw) ?? "?"}</td>
                    <td>{row.is_living === null ? "?" : row.is_living ? "Living" : "Deceased"}</td>
                    <td className="text-slate-500">{row.tree_id}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}
