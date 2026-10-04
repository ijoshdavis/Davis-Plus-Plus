"use client";

import { useEffect, useRef, useState } from "react";

import { primaryName } from "@/lib/gedcom";
import { useCurrentPersonId } from "@/lib/identity";
import { supabase } from "@/lib/supabase";
import { DEFAULT_PAGE_SIZE, fetchAllPages } from "@/lib/supabasePaging";

type Candidate = { person_id: string; name: string };

export function IdentityPicker() {
  const [personId, setPersonId] = useCurrentPersonId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [fetchedName, setFetchedName] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || candidates) return;
    (async () => {
      const rows = await fetchAllPages<{ person_id: string; raw: Parameters<typeof primaryName>[0] }>(
        DEFAULT_PAGE_SIZE,
        (from, to) => supabase.from("persona").select("person_id, raw").order("person_id").range(from, to)
      );
      const byPerson = new Map<string, string>();
      for (const r of rows) {
        if (!byPerson.has(r.person_id)) byPerson.set(r.person_id, primaryName(r.raw).display);
      }
      setCandidates(
        [...byPerson.entries()]
          .map(([person_id, name]) => ({ person_id, name }))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    })();
  }, [open, candidates]);

  // Only need a standalone fetch when the popover hasn't loaded the full
  // candidate list yet (e.g. identity was set in another tab).
  useEffect(() => {
    if (!personId || candidates?.some((c) => c.person_id === personId)) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("persona").select("raw").eq("person_id", personId).limit(1).maybeSingle();
      if (!cancelled && data) setFetchedName(primaryName(data.raw as Parameters<typeof primaryName>[0]).display);
    })();
    return () => {
      cancelled = true;
    };
  }, [personId, candidates]);

  const currentName = personId
    ? (candidates?.find((c) => c.person_id === personId)?.name ?? fetchedName)
    : null;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const needle = search.trim().toLowerCase();
  const filtered = candidates?.filter((c) => !needle || c.name.toLowerCase().includes(needle)).slice(0, 30);

  return (
    <div ref={containerRef} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="rounded border px-2 py-1 text-xs text-slate-600 hover:text-slate-900">
        {currentName ? `You: ${currentName}` : "Who am I?"}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded border bg-white p-2 shadow-lg">
          <input
            autoFocus
            type="search"
            placeholder="Search your name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-2 w-full rounded border px-2 py-1 text-sm"
          />
          {!candidates ? (
            <p className="p-1 text-xs text-slate-500">Loading...</p>
          ) : (
            <ul className="max-h-64 overflow-auto text-sm">
              {personId && (
                <li>
                  <button
                    onClick={() => {
                      setPersonId(null);
                      setOpen(false);
                    }}
                    className="w-full rounded px-2 py-1 text-left text-slate-500 hover:bg-slate-50"
                  >
                    Clear
                  </button>
                </li>
              )}
              {filtered?.map((c) => (
                <li key={c.person_id}>
                  <button
                    onClick={() => {
                      setPersonId(c.person_id);
                      setOpen(false);
                    }}
                    className={`w-full rounded px-2 py-1 text-left hover:bg-slate-50 ${
                      c.person_id === personId ? "font-semibold text-blue-700" : ""
                    }`}
                  >
                    {c.name}
                  </button>
                </li>
              ))}
              {filtered?.length === 0 && <li className="p-1 text-xs text-slate-500">No matches</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
