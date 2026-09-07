"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Nav } from "./nav";
import { supabase } from "@/lib/supabase";
import { useRequireSession } from "@/lib/useSession";

export default function Home() {
  const session = useRequireSession();
  const [counts, setCounts] = useState<{ people: number; findings: number } | null>(null);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const [{ count: people }, { count: findings }] = await Promise.all([
        supabase.from("person").select("*", { count: "exact", head: true }),
        supabase.from("finding").select("*", { count: "exact", head: true }).eq("status", "open"),
      ]);
      setCounts({ people: people ?? 0, findings: findings ?? 0 });
    })();
  }, [session]);

  if (!session) return null;

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="mb-4 text-xl font-semibold">Dashboard</h1>
        <div className="flex gap-4">
          <Link href="/people" className="rounded border p-4 hover:bg-slate-50">
            <div className="text-2xl font-semibold">{counts?.people ?? "..."}</div>
            <div className="text-sm text-slate-600">people you can see</div>
          </Link>
          <Link href="/findings" className="rounded border p-4 hover:bg-slate-50">
            <div className="text-2xl font-semibold">{counts?.findings ?? "..."}</div>
            <div className="text-sm text-slate-600">open findings</div>
          </Link>
        </div>
      </main>
    </>
  );
}
