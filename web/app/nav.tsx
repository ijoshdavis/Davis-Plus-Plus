"use client";

import Link from "next/link";

import { supabase } from "@/lib/supabase";

export function Nav() {
  return (
    <nav className="flex items-center gap-4 border-b px-6 py-3 text-sm">
      <span className="font-semibold">Kinstore</span>
      <Link href="/people" className="text-slate-600 hover:text-slate-900">
        People
      </Link>
      <Link href="/findings" className="text-slate-600 hover:text-slate-900">
        Findings
      </Link>
      <button
        onClick={() => supabase.auth.signOut()}
        className="ml-auto text-slate-500 hover:text-slate-900"
      >
        Sign out
      </button>
    </nav>
  );
}
