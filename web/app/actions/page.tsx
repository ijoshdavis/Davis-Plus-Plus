"use client";

import { useEffect, useState } from "react";

import { Nav } from "../nav";
import { supabase } from "@/lib/supabase";
import { useRequireSession } from "@/lib/useSession";

type Finding = {
  id: string;
  rule: string;
  severity: string;
  details: Record<string, unknown>;
};

type TaskKind = "user_decision" | "chrome_research";
type TaskStatus = "proposed" | "approved" | "declined" | "done";

type ResearchTask = {
  id: string;
  kind: TaskKind;
  instructions: string;
  status: TaskStatus;
  result: string | null;
  created_at: string;
  finding: Finding | Finding[] | null;
};

// PostgREST embeds a to-one FK relationship as an object, but this hasn't
// been exercised against a live project yet in this workspace (no Supabase
// credentials here - see the README note in this PR) - normalize defensively
// rather than assume the shape.
function oneFinding(f: ResearchTask["finding"]): Finding | null {
  return Array.isArray(f) ? (f[0] ?? null) : f;
}

const KIND_LABEL: Record<TaskKind, string> = {
  user_decision: "Needs your decision",
  chrome_research: "Approve for Claude to research in Chrome",
};

const STATUS_ORDER: Record<TaskStatus, number> = { proposed: 0, approved: 1, done: 2, declined: 3 };

export default function ActionsPage() {
  const session = useRequireSession();
  const [tasks, setTasks] = useState<ResearchTask[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draftResult, setDraftResult] = useState<Record<string, string>>({});

  async function load() {
    const { data, error } = await supabase
      .from("research_task")
      .select("id, kind, instructions, status, result, created_at, finding(id, rule, severity, details)")
      .order("created_at");
    if (error) console.error(error);
    const rows = (data ?? []) as unknown as ResearchTask[];
    rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
    setTasks(rows);
  }

  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data, error } = await supabase
        .from("research_task")
        .select("id, kind, instructions, status, result, created_at, finding(id, rule, severity, details)")
        .order("created_at");
      if (error) console.error(error);
      const rows = (data ?? []) as unknown as ResearchTask[];
      rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
      setTasks(rows);
    })();
  }, [session]);

  async function setStatus(taskId: string, status: TaskStatus) {
    setBusy(taskId);
    const { error } = await supabase.from("research_task").update({ status }).eq("id", taskId);
    setBusy(null);
    if (error) {
      alert(error.message);
      return;
    }
    load();
  }

  async function resolve(taskId: string) {
    const result = draftResult[taskId]?.trim();
    if (!result) return;
    setBusy(taskId);
    const { error } = await supabase.from("research_task").update({ status: "done", result }).eq("id", taskId);
    setBusy(null);
    if (error) {
      alert(error.message);
      return;
    }
    load();
  }

  if (!session) return null;

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="mb-1 text-xl font-semibold">Actions</h1>
        <p className="mb-4 text-sm text-slate-500">
          Concrete next steps toward resolving a finding — either a call only you can make, or a
          read-only Ancestry.com lookup you can approve for Claude to run. Nothing here ever
          writes back to Ancestry; corrections still flow through Findings.
        </p>

        {!tasks ? (
          <p className="text-slate-500">Loading...</p>
        ) : tasks.length === 0 ? (
          <p className="text-slate-500">No research tasks yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {tasks.map((t) => {
              const finding = oneFinding(t.finding);
              return (
                <li key={t.id} className="rounded border p-3 text-sm">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium">
                      {KIND_LABEL[t.kind]}
                    </span>
                    <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">
                      {t.status}
                    </span>
                    {finding && <span className="text-xs text-slate-400">from finding: {finding.rule}</span>}
                  </div>

                  <p className="mb-2 text-slate-800">{t.instructions}</p>

                  {finding && (
                    <pre className="mb-2 overflow-x-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-600">
                      {JSON.stringify(finding.details, null, 2)}
                    </pre>
                  )}

                  {t.kind === "chrome_research" && t.status === "proposed" && (
                    <div className="flex gap-2">
                      <button
                        disabled={busy === t.id}
                        onClick={() => setStatus(t.id, "approved")}
                        className="rounded bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        disabled={busy === t.id}
                        onClick={() => setStatus(t.id, "declined")}
                        className="text-xs text-slate-500 hover:text-slate-900"
                      >
                        Decline
                      </button>
                    </div>
                  )}

                  {t.kind === "chrome_research" && t.status === "approved" && (
                    <p className="text-xs text-slate-500">
                      Approved — ask Claude to work the approved queue next session.
                    </p>
                  )}

                  {t.kind === "user_decision" && (t.status === "proposed" || t.status === "approved") && (
                    <div className="flex items-center gap-2">
                      <input
                        placeholder="Your decision / answer"
                        className="flex-1 rounded border px-2 py-1 text-xs"
                        value={draftResult[t.id] ?? ""}
                        onChange={(e) => setDraftResult((s) => ({ ...s, [t.id]: e.target.value }))}
                      />
                      <button
                        disabled={busy === t.id}
                        onClick={() => resolve(t.id)}
                        className="rounded bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50"
                      >
                        Mark resolved
                      </button>
                    </div>
                  )}

                  {t.status === "done" && t.result && (
                    <p className="rounded bg-emerald-50 p-2 text-xs text-emerald-900">{t.result}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
