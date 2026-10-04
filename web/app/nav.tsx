"use client";

import Link from "next/link";

import { IdentityPicker } from "./identity-picker";
import { supabase } from "@/lib/supabase";

export function Nav() {
  return (
    <nav className="flex items-center gap-4 border-b px-6 py-3 text-sm">
      <Link href="/" className="font-semibold text-slate-900 hover:text-slate-700">
        Kinstore
      </Link>
      <Link href="/people" className="text-slate-600 hover:text-slate-900">
        People
      </Link>
      <Link href="/graph" className="text-slate-600 hover:text-slate-900">
        Graph
      </Link>
      <Link href="/findings" className="text-slate-600 hover:text-slate-900">
        Findings
      </Link>
      <Link href="/actions" className="text-slate-600 hover:text-slate-900">
        Actions
      </Link>
      <div className="ml-auto flex items-center gap-3">
        <IdentityPicker />
        <button onClick={() => supabase.auth.signOut()} className="text-slate-500 hover:text-slate-900">
          Sign out
        </button>
      </div>
    </nav>
  );
}
