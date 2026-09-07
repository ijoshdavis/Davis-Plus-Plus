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

// Supabase's PostgREST caps every response at 1,000 rows server-side
// regardless of a client-requested .limit() - confirmed directly against
// this project (content-range: 0-999/*). With ~3,135 personas, a single
// query silently drops two-thirds of the table. Page through with .range()
// instead, ordered by a unique column so pages don't skip/duplicate rows.
const PAGE_SIZE = 1000;

async function fetchAllPages<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error(error);
      break;
    }
    all.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

export default function PeoplePage() {
  const session = useRequireSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [treeFilter, setTreeFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!session) return;
    (async () => {
      const personas = await fetchAllPages<Omit<Row, "is_living">>((from, to) =>
        supabase
          .from("persona")
          .select("id, person_id, tree_id, external_xref, raw")
          .order("tree_id")
          .order("id")
          .range(from, to)
      );

      const personIds = [...new Set(personas.map((p) => p.person_id))];
      const privacy = await fetchAllPages<{ person_id: string; is_living: boolean }>((from, to) =>
        supabase
          .from("person_privacy")
          .select("person_id, is_living")
          .in("person_id", personIds)
          .order("person_id")
          .range(from, to)
      );
      const livingByPerson = new Map(privacy.map((p) => [p.person_id, p.is_living]));

      setRows(personas.map((p) => ({ ...p, is_living: livingByPerson.get(p.person_id) ?? null })));
    })();
  }, [session]);

  if (!session) return null;

  const trees = rows ? [...new Set(rows.map((r) => r.tree_id))] : [];
  const needle = search.trim().toLowerCase();
  const filtered = rows?.filter((r) => {
    if (treeFilter && r.tree_id !== treeFilter) return false;
    if (!needle) return true;
    return primaryName(r.raw as Parameters<typeof primaryName>[0]).display.toLowerCase().includes(needle);
  });

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-4xl p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">People</h1>
          <div className="flex gap-2">
            <input
              type="search"
              placeholder="Search by name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded border px-2 py-1 text-sm"
            />
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
        </div>
        {!filtered ? (
          <p className="text-slate-500">Loading...</p>
        ) : (
          <>
            <p className="mb-2 text-xs text-slate-500">
              {filtered.length} of {rows?.length ?? 0}
            </p>
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
          </>
        )}
      </main>
    </>
  );
}
