"use client";

import { useEffect, useState } from "react";

import { Nav } from "../nav";
import { supabase } from "@/lib/supabase";
import { useRequireSession } from "@/lib/useSession";

type Finding = {
  id: string;
  rule: string;
  severity: string;
  tree_id: string | null;
  details: Record<string, unknown>;
  status: string;
};

export default function FindingsPage() {
  const session = useRequireSession();
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [ruleFilter, setRuleFilter] = useState("");
  const [applyState, setApplyState] = useState<Record<string, { given: string; surname: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("finding")
      .select("id, rule, severity, tree_id, details, status")
      .eq("status", "open")
      .order("rule")
      .limit(1000);
    if (error) console.error(error);
    setFindings(data ?? []);
  }

  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data, error } = await supabase
        .from("finding")
        .select("id, rule, severity, tree_id, details, status")
        .eq("status", "open")
        .order("rule")
        .limit(1000);
      if (error) console.error(error);
      setFindings(data ?? []);
    })();
  }, [session]);

  async function applyMarriedName(findingId: string) {
    const values = applyState[findingId];
    if (!values?.given || !values?.surname) return;
    setBusy(findingId);
    const { error } = await supabase.rpc("apply_missing_married_name", {
      p_finding_id: findingId,
      p_given: values.given,
      p_surname: values.surname,
    });
    setBusy(null);
    if (error) {
      alert(error.message);
      return;
    }
    load();
  }

  async function dismiss(findingId: string) {
    setBusy(findingId);
    const { error } = await supabase.from("finding").update({ status: "dismissed" }).eq("id", findingId);
    setBusy(null);
    if (error) {
      alert(error.message);
      return;
    }
    load();
  }

  if (!session) return null;

  const rules = findings ? [...new Set(findings.map((f) => f.rule))].sort() : [];
  const filtered = ruleFilter ? findings?.filter((f) => f.rule === ruleFilter) : findings;

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-4xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Findings</h1>
          <select
            value={ruleFilter}
            onChange={(e) => setRuleFilter(e.target.value)}
            className="rounded border px-2 py-1 text-sm"
          >
            <option value="">All rules ({findings?.length ?? 0})</option>
            {rules.map((r) => (
              <option key={r} value={r}>
                {r} ({findings?.filter((f) => f.rule === r).length})
              </option>
            ))}
          </select>
        </div>

        {!filtered ? (
          <p className="text-slate-500">Loading...</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((f) => (
              <li key={f.id} className="rounded border p-3 text-sm">
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium">{f.rule}</span>
                  <span className="text-xs text-slate-500">{f.severity}</span>
                  {f.tree_id && <span className="text-xs text-slate-400">{f.tree_id}</span>}
                </div>
                <pre className="mb-2 overflow-x-auto whitespace-pre-wrap text-xs text-slate-700">
                  {JSON.stringify(f.details, null, 2)}
                </pre>

                {f.rule === "missing_married_name" && (
                  <div className="flex items-center gap-2">
                    <input
                      placeholder="Given name"
                      className="rounded border px-2 py-1 text-xs"
                      value={applyState[f.id]?.given ?? ""}
                      onChange={(e) =>
                        setApplyState((s) => ({ ...s, [f.id]: { ...s[f.id], given: e.target.value, surname: s[f.id]?.surname ?? "" } }))
                      }
                    />
                    <input
                      placeholder="Married surname"
                      className="rounded border px-2 py-1 text-xs"
                      value={applyState[f.id]?.surname ?? ""}
                      onChange={(e) =>
                        setApplyState((s) => ({ ...s, [f.id]: { ...s[f.id], surname: e.target.value, given: s[f.id]?.given ?? "" } }))
                      }
                    />
                    <button
                      disabled={busy === f.id}
                      onClick={() => applyMarriedName(f.id)}
                      className="rounded bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50"
                    >
                      Apply
                    </button>
                  </div>
                )}
                <button
                  disabled={busy === f.id}
                  onClick={() => dismiss(f.id)}
                  className="mt-2 text-xs text-slate-500 hover:text-slate-900"
                >
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
