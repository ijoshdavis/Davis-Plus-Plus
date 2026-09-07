"use client";

import { useEffect, useState } from "react";

import { Nav } from "./nav";
import { supabase } from "@/lib/supabase";
import { useRequireSession } from "@/lib/useSession";

type Stats = {
  people: number;
  families: number;
  sources: number;
  citations: number;
  repositories: number;
  openFindings: number;
  namesApplied: number;
};

async function loadStats(): Promise<Stats> {
  const [people, families, sources, citations, repositories, openFindings, namesApplied] =
    await Promise.all([
      supabase.from("person").select("*", { count: "exact", head: true }),
      supabase.from("family_persona").select("*", { count: "exact", head: true }),
      supabase.from("source").select("*", { count: "exact", head: true }),
      supabase.from("citation").select("*", { count: "exact", head: true }),
      supabase.from("repository").select("*", { count: "exact", head: true }),
      supabase.from("finding").select("*", { count: "exact", head: true }).eq("status", "open"),
      supabase.from("person_name").select("*", { count: "exact", head: true }),
    ]);

  return {
    people: people.count ?? 0,
    families: families.count ?? 0,
    sources: sources.count ?? 0,
    citations: citations.count ?? 0,
    repositories: repositories.count ?? 0,
    openFindings: openFindings.count ?? 0,
    namesApplied: namesApplied.count ?? 0,
  };
}

function formatCompact(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function StatTile({ label, value, accent }: { label: string; value: number; accent?: "warning" }) {
  return (
    <div className="rounded border p-4">
      <div className="flex items-center gap-1.5 text-sm text-slate-500">
        {accent === "warning" && value > 0 && (
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
        )}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{formatCompact(value)}</div>
    </div>
  );
}

export default function Home() {
  const session = useRequireSession();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (!session) return;
    loadStats().then(setStats);
  }, [session]);

  if (!session) return null;

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-4 text-xl font-semibold">Dashboard</h1>
        {!stats ? (
          <p className="text-slate-500">Loading...</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="People" value={stats.people} />
            <StatTile label="Families" value={stats.families} />
            <StatTile label="Sources" value={stats.sources} />
            <StatTile label="Citations" value={stats.citations} />
            <StatTile label="Repositories" value={stats.repositories} />
            <StatTile label="Open findings" value={stats.openFindings} accent="warning" />
            <StatTile label="Names applied" value={stats.namesApplied} />
          </div>
        )}
      </main>
    </>
  );
}
