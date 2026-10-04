"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";

import { Nav } from "../nav";
import { GraphCanvas, type GraphForces } from "./GraphCanvas";
import { loadGraphData, type GraphData } from "@/lib/graphData";
import { useCurrentPersonId } from "@/lib/identity";
import { useRequireSession } from "@/lib/useSession";

const DEFAULT_FORCES: GraphForces = {
  center: 0.3,
  repel: 120,
  linkForce: 0.6,
  linkDistance: 60,
  nodeSize: 1,
  linkThickness: 1,
};

function mostConnected(data: GraphData): string | null {
  if (data.nodes.length === 0) return null;
  return data.nodes.reduce((best, n) => (n.degree > best.degree ? n : best)).id;
}

export default function GraphPage() {
  const session = useRequireSession();
  const [identityId] = useCurrentPersonId();
  const [data, setData] = useState<GraphData | null>(null);
  // Explicit user choice (from clicking a node or "Back to me"). Until the
  // user picks someone, focus derives from identity/data below rather than
  // being pushed into state from an effect.
  const [explicitFocusId, setExplicitFocusId] = useState<string | null>(null);
  const [forces, setForces] = useState<GraphForces>(DEFAULT_FORCES);
  const [showOrphans, setShowOrphans] = useState(true);
  const [search, setSearch] = useState("");
  const [animateToken, setAnimateToken] = useState(0);

  useEffect(() => {
    if (!session) return;
    loadGraphData().then(setData);
  }, [session]);

  const defaultFocusId = useMemo(() => (data ? mostConnected(data) : null), [data]);
  const focusId = explicitFocusId ?? identityId ?? defaultFocusId;

  const focusName = useMemo(() => data?.nodes.find((n) => n.id === focusId)?.name ?? null, [data, focusId]);

  if (!session) return null;

  return (
    <div className="flex h-screen flex-col">
      <Nav />
      <div className="flex min-h-0 flex-1">
        <div className="relative flex-1">
          {!data ? (
            <div className="flex h-full items-center justify-center bg-[#333b4d] text-slate-300">
              Loading graph...
            </div>
          ) : data.nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center bg-[#333b4d] text-slate-300">
              No people found yet.
            </div>
          ) : (
            <GraphCanvas
              nodes={data.nodes}
              edges={data.edges}
              focusId={focusId}
              identityId={identityId}
              showOrphans={showOrphans}
              search={search}
              forces={forces}
              animateToken={animateToken}
              onNodeClick={setExplicitFocusId}
            />
          )}
          <div className="absolute left-3 top-3 flex items-center gap-3 rounded bg-black/40 px-3 py-1.5 text-xs text-slate-100">
            <span>Focus: {focusName ?? "—"}</span>
            {identityId && focusId !== identityId && (
              <button
                onClick={() => setExplicitFocusId(identityId)}
                className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20"
              >
                Back to me
              </button>
            )}
            {!identityId && (
              <span className="text-slate-400">Set &quot;Who am I?&quot; in the nav to focus on yourself</span>
            )}
          </div>
        </div>

        <aside className="w-72 shrink-0 overflow-y-auto border-l border-slate-700 bg-[#2b313f] p-4 text-sm text-slate-200">
          <Section title="Filters">
            <input
              type="search"
              placeholder="Search people..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded border border-slate-600 bg-[#333b4d] px-2 py-1 text-sm text-slate-100 placeholder:text-slate-400"
            />
            <label className="mt-3 flex items-center justify-between">
              Orphans
              <input type="checkbox" checked={showOrphans} onChange={(e) => setShowOrphans(e.target.checked)} />
            </label>
          </Section>

          <Section title="Display">
            <Slider
              label="Node size"
              value={forces.nodeSize}
              min={0.4}
              max={3}
              step={0.05}
              onChange={(v) => setForces((f) => ({ ...f, nodeSize: v }))}
            />
            <Slider
              label="Link thickness"
              value={forces.linkThickness}
              min={0.3}
              max={4}
              step={0.1}
              onChange={(v) => setForces((f) => ({ ...f, linkThickness: v }))}
            />
            <button
              onClick={() => setAnimateToken((t) => t + 1)}
              className="mt-2 w-full rounded bg-slate-600 py-1.5 text-slate-100 hover:bg-slate-500"
            >
              Animate
            </button>
          </Section>

          <Section title="Forces">
            <Slider
              label="Center force"
              value={forces.center}
              min={0}
              max={1}
              step={0.02}
              onChange={(v) => setForces((f) => ({ ...f, center: v }))}
            />
            <Slider
              label="Repel force"
              value={forces.repel}
              min={0}
              max={400}
              step={5}
              onChange={(v) => setForces((f) => ({ ...f, repel: v }))}
            />
            <Slider
              label="Link force"
              value={forces.linkForce}
              min={0}
              max={1}
              step={0.02}
              onChange={(v) => setForces((f) => ({ ...f, linkForce: v }))}
            />
            <Slider
              label="Link distance"
              value={forces.linkDistance}
              min={10}
              max={200}
              step={2}
              onChange={(v) => setForces((f) => ({ ...f, linkDistance: v }))}
            />
          </Section>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-5 border-b border-slate-700 pb-4 last:border-0">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      {children}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="mb-2 block">
      <div className="mb-1 flex justify-between text-xs text-slate-300">
        <span>{label}</span>
        <span>{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
      />
    </label>
  );
}
