"use client";

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { GraphEdge, GraphNode } from "@/lib/graphData";

export type GraphForces = {
  center: number;
  repel: number;
  linkForce: number;
  linkDistance: number;
  nodeSize: number;
  linkThickness: number;
};

type SimNode = GraphNode & SimulationNodeDatum;
type SimLink = { source: SimNode | string; target: SimNode | string; kind: GraphEdge["kind"] };

type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focusId: string | null;
  identityId: string | null;
  showOrphans: boolean;
  search: string;
  forces: GraphForces;
  animateToken: number;
  onNodeClick: (id: string) => void;
};

const BG = "#333b4d";
const LINK_COLOR = "rgba(148, 163, 184, 0.35)";
const NODE_COLOR = "#e7ebf3";
const NODE_DIM_COLOR = "rgba(231, 235, 243, 0.18)";
const FOCUS_COLOR = "#f59e0b";
const IDENTITY_COLOR = "#34d399";

function nodeRadius(node: SimNode, nodeSize: number) {
  return (4 + Math.sqrt(node.degree) * 3) * nodeSize;
}

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;

// Settled node positions and the camera transform, kept outside React state
// so navigating away from /graph and back doesn't force the whole ~3,000-
// node layout to re-randomize and resettle from scratch. Lives for the tab's
// session (reset on a hard reload), same lifetime as the data cache in
// lib/graphData.ts.
const viewState: {
  positions: Map<string, { x: number; y: number }>;
  transform: { x: number; y: number; k: number } | null;
} = { positions: new Map(), transform: null };

export function GraphCanvas({
  nodes,
  edges,
  focusId,
  identityId,
  showOrphans,
  search,
  forces,
  animateToken,
  onNodeClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const simLinksRef = useRef<SimLink[]>([]);
  const sizeRef = useRef({ width: 800, height: 600 });
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<{ node: SimNode | null; panning: boolean; lastX: number; lastY: number; moved: number }>({
    node: null,
    panning: false,
    lastX: 0,
    lastY: 0,
    moved: 0,
  });
  const forcesRef = useRef(forces);
  const focusRef = useRef(focusId);
  const identityRef = useRef(identityId);
  const showOrphansRef = useRef(showOrphans);
  const searchRef = useRef(search);
  const onNodeClickRef = useRef(onNodeClick);
  const hoverIdRef = useRef<string | null>(null);
  const hoverClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hover, setHover] = useState<{ node: SimNode; x: number; y: number } | null>(null);
  const skipNextSnapRef = useRef(false);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const zoomAtRef = useRef<(factor: number, cx: number, cy: number) => void>(() => {});
  const initialZoomPct = Math.round((viewState.transform?.k ?? 1) * 100);

  // Keep "latest value" refs in sync for the imperative render/pointer code
  // below, which reads them outside React's render cycle.
  useLayoutEffect(() => {
    forcesRef.current = forces;
    focusRef.current = focusId;
    identityRef.current = identityId;
    showOrphansRef.current = showOrphans;
    searchRef.current = search;
    onNodeClickRef.current = onNodeClick;
  });

  const render = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { width, height } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    const t = transformRef.current;
    const f = forcesRef.current;
    const needle = searchRef.current.trim().toLowerCase();
    const dimming = needle.length > 0;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, width, height);

    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    ctx.lineWidth = Math.max(0.4, f.linkThickness);
    ctx.strokeStyle = LINK_COLOR;
    ctx.beginPath();
    for (const link of simLinksRef.current) {
      const s = link.source as SimNode;
      const tgt = link.target as SimNode;
      if (typeof s !== "object" || typeof tgt !== "object") continue;
      if (!showOrphansRef.current && (s.degree === 0 || tgt.degree === 0)) continue;
      ctx.moveTo(s.x ?? 0, s.y ?? 0);
      ctx.lineTo(tgt.x ?? 0, tgt.y ?? 0);
    }
    ctx.stroke();

    for (const node of simNodesRef.current) {
      if (!showOrphansRef.current && node.degree === 0) continue;
      const r = nodeRadius(node, f.nodeSize);
      const matches = !dimming || node.name.toLowerCase().includes(needle);
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, Math.PI * 2);
      ctx.fillStyle = matches ? NODE_COLOR : NODE_DIM_COLOR;
      ctx.fill();

      if (node.id === identityRef.current) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = IDENTITY_COLOR;
        ctx.stroke();
      }
      if (node.id === hoverIdRef.current && node.id !== focusRef.current) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
        ctx.beginPath();
        ctx.arc(node.x ?? 0, node.y ?? 0, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (node.id === focusRef.current) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = FOCUS_COLOR;
        ctx.beginPath();
        ctx.arc(node.x ?? 0, node.y ?? 0, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  };

  // Track container size.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      sizeRef.current = { width: entry.contentRect.width, height: entry.contentRect.height };
      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = sizeRef.current.width * dpr;
        canvas.height = sizeRef.current.height * dpr;
        canvas.style.width = `${sizeRef.current.width}px`;
        canvas.style.height = `${sizeRef.current.height}px`;
      }
      render();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build/replace simulation when data changes.
  useEffect(() => {
    const { width, height } = sizeRef.current;
    const simNodes: SimNode[] = nodes.map((n) => ({ ...n }));
    const byId = new Map(simNodes.map((n) => [n.id, n]));
    const simLinks: SimLink[] = edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, kind: e.kind }));

    // Restore last-known positions/camera (e.g. returning to /graph after
    // navigating away) instead of re-laying out from a random start.
    let restoredCount = 0;
    for (const n of simNodes) {
      const cached = viewState.positions.get(n.id);
      if (cached) {
        n.x = cached.x;
        n.y = cached.y;
        restoredCount++;
      }
    }
    if (viewState.transform) {
      transformRef.current = viewState.transform;
      skipNextSnapRef.current = true;
      if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(viewState.transform.k * 100)}%`;
    }

    simNodesRef.current = simNodes;
    simLinksRef.current = simLinks;

    const sim = forceSimulation(simNodes)
      .force("charge", forceManyBody().strength(-forcesRef.current.repel))
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(forcesRef.current.linkDistance)
          .strength(forcesRef.current.linkForce)
      )
      .force("x", forceX(width / 2).strength(forcesRef.current.center * 0.15))
      .force("y", forceY(height / 2).strength(forcesRef.current.center * 0.15))
      .force("collide", forceCollide<SimNode>((d) => nodeRadius(d, forcesRef.current.nodeSize) + 2))
      .on("tick", render);

    // Most nodes already had a good position - a full alpha=1 restart would
    // visibly re-explode and resettle the whole layout for no reason.
    if (restoredCount > simNodes.length / 2) sim.alpha(0.05);

    simRef.current = sim;
    return () => {
      for (const n of simNodesRef.current) {
        if (n.x != null && n.y != null) viewState.positions.set(n.id, { x: n.x, y: n.y });
      }
      viewState.transform = { ...transformRef.current };
      sim.stop();
    };
  }, [nodes, edges]);

  // Update force parameters on slider changes without resetting positions.
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    sim.force<ReturnType<typeof forceManyBody>>("charge")?.strength(-forces.repel);
    sim
      .force<ReturnType<typeof forceLink<SimNode, SimLink>>>("link")
      ?.distance(forces.linkDistance)
      .strength(forces.linkForce);
    sim.force<ReturnType<typeof forceX>>("x")?.strength(forces.center * 0.15);
    sim.force<ReturnType<typeof forceY>>("y")?.strength(forces.center * 0.15);
    sim
      .force<ReturnType<typeof forceCollide<SimNode>>>("collide")
      ?.radius((d) => nodeRadius(d as SimNode, forces.nodeSize) + 2);
    sim.alpha(0.4).restart();
  }, [forces]);

  // Reheat on "Animate".
  const isFirstAnimate = useRef(true);
  useEffect(() => {
    if (isFirstAnimate.current) {
      isFirstAnimate.current = false;
      return;
    }
    simRef.current?.alpha(1).restart();
  }, [animateToken]);

  // Snap camera to focus node - except right after restoring a cached
  // camera position, where the user's own last view should win instead.
  useEffect(() => {
    if (!focusId) return;
    if (skipNextSnapRef.current) {
      skipNextSnapRef.current = false;
      return;
    }
    const node = simNodesRef.current.find((n) => n.id === focusId);
    if (!node) return;
    const { width, height } = sizeRef.current;
    const t = transformRef.current;
    transformRef.current = { ...t, x: width / 2 - (node.x ?? 0) * t.k, y: height / 2 - (node.y ?? 0) * t.k };
    render();
  }, [focusId]);

  // Redraw when purely-visual props change, independent of simulation ticks.
  useEffect(() => {
    render();
  }, [search, showOrphans]);

  // Stable wrapper the zoom bar buttons can call; the real implementation
  // lives inside the pointer-interaction effect below (mount-once, so it
  // can't be called directly from JSX) and registers itself here.
  const zoomByButton = (factor: number) => {
    const { width, height } = sizeRef.current;
    zoomAtRef.current(factor, width / 2, height / 2);
  };

  // Pointer interaction: drag nodes, pan, zoom, click-to-focus.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Zoom around a screen point (canvas-relative); shared by the wheel
    // handler and the +/- zoom bar buttons (via zoomAtRef).
    const zoomAt = (factor: number, cx: number, cy: number) => {
      const t = transformRef.current;
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.k * factor));
      const x = cx - ((cx - t.x) / t.k) * k;
      const y = cy - ((cy - t.y) / t.k) * k;
      transformRef.current = { x, y, k };
      if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(k * 100)}%`;
      render();
    };
    zoomAtRef.current = zoomAt;

    const toGraph = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const t = transformRef.current;
      return { x: (clientX - rect.left - t.x) / t.k, y: (clientY - rect.top - t.y) / t.k };
    };

    const hitTest = (gx: number, gy: number) => {
      for (let i = simNodesRef.current.length - 1; i >= 0; i--) {
        const node = simNodesRef.current[i];
        if (!showOrphansRef.current && node.degree === 0) continue;
        const r = nodeRadius(node, forcesRef.current.nodeSize) + 3;
        const dx = (node.x ?? 0) - gx;
        const dy = (node.y ?? 0) - gy;
        if (dx * dx + dy * dy <= r * r) return node;
      }
      return null;
    };

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const { x: gx, y: gy } = toGraph(e.clientX, e.clientY);
      const node = hitTest(gx, gy);
      dragRef.current = { node, panning: !node, lastX: e.clientX, lastY: e.clientY, moved: 0 };
      if (node) {
        node.fx = node.x;
        node.fy = node.y;
        simRef.current?.alphaTarget(0.3).restart();
      }
    };

    // Clearing hover the instant the cursor leaves a node's hit radius means
    // it vanishes before you can reach the tooltip below it (there's a gap
    // between the node and the tooltip's top-left corner) - so a "no node
    // here" result gets a short grace period to cover that transit, canceled
    // as soon as a node (or the tooltip itself, via its own onMouseLeave) is
    // reached again.
    const clearHover = () => {
      hoverIdRef.current = null;
      canvas.style.cursor = dragRef.current.panning ? "grabbing" : "grab";
      setHover(null);
    };

    const setHoverNode = (node: SimNode | null, e: PointerEvent) => {
      if (hoverClearTimeoutRef.current !== null) {
        clearTimeout(hoverClearTimeoutRef.current);
        hoverClearTimeoutRef.current = null;
      }
      if (!node) {
        hoverClearTimeoutRef.current = setTimeout(clearHover, 400);
        return;
      }
      hoverIdRef.current = node.id;
      canvas.style.cursor = "pointer";
      const rect = canvas.getBoundingClientRect();
      setHover({ node, x: e.clientX - rect.left, y: e.clientY - rect.top });
    };

    const onPointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag.node && !drag.panning) {
        // Idle - just tracking hover for the tooltip.
        const { x: gx, y: gy } = toGraph(e.clientX, e.clientY);
        setHoverNode(hitTest(gx, gy), e);
        return;
      }
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);

      if (drag.node) {
        const { x: gx, y: gy } = toGraph(e.clientX, e.clientY);
        drag.node.fx = gx;
        drag.node.fy = gy;
        setHoverNode(drag.node, e);
      } else if (drag.panning) {
        transformRef.current = {
          ...transformRef.current,
          x: transformRef.current.x + dx,
          y: transformRef.current.y + dy,
        };
        render();
      }
    };

    const onPointerLeave = () => {
      if (hoverClearTimeoutRef.current !== null) {
        clearTimeout(hoverClearTimeoutRef.current);
        hoverClearTimeoutRef.current = null;
      }
      hoverIdRef.current = null;
      setHover(null);
    };

    const onPointerUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (drag.node) {
        drag.node.fx = null;
        drag.node.fy = null;
        simRef.current?.alphaTarget(0);
        if (drag.moved < 5) onNodeClickRef.current(drag.node.id);
      }
      dragRef.current = { node: null, panning: false, lastX: 0, lastY: 0, moved: 0 };
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.001), e.clientX - rect.left, e.clientY - rect.top);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      if (hoverClearTimeoutRef.current !== null) clearTimeout(hoverClearTimeoutRef.current);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="block cursor-grab touch-none active:cursor-grabbing" />
      <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-slate-600 bg-slate-900/90 px-2 py-1 text-slate-100 shadow-lg">
        <button
          onClick={() => zoomByButton(1 / 1.3)}
          aria-label="Zoom out"
          className="flex h-7 w-7 items-center justify-center rounded-full text-lg leading-none hover:bg-white/10"
        >
          −
        </button>
        <span ref={zoomLabelRef} className="w-12 text-center text-xs tabular-nums text-slate-300">
          {initialZoomPct}%
        </span>
        <button
          onClick={() => zoomByButton(1.3)}
          aria-label="Zoom in"
          className="flex h-7 w-7 items-center justify-center rounded-full text-lg leading-none hover:bg-white/10"
        >
          +
        </button>
      </div>
      {hover && (
        <div
          className="absolute z-10 max-w-[220px] rounded border border-slate-600 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-lg"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
          onMouseEnter={() => {
            if (hoverClearTimeoutRef.current !== null) {
              clearTimeout(hoverClearTimeoutRef.current);
              hoverClearTimeoutRef.current = null;
            }
          }}
          onMouseLeave={() => {
            hoverIdRef.current = null;
            setHover(null);
          }}
        >
          <div className="font-semibold">{hover.node.name}</div>
          {(hover.node.birthYear || hover.node.deathYear) && (
            <div className="mt-0.5 text-slate-400">
              {hover.node.birthYear ?? "?"}–{hover.node.deathYear ?? ""}
            </div>
          )}
          {hover.node.ancestryUrl ? (
            <a
              href={hover.node.ancestryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-blue-400 hover:text-blue-300 hover:underline"
            >
              Open in Ancestry ↗
            </a>
          ) : (
            <div className="mt-1 text-slate-500">No Ancestry link on file</div>
          )}
        </div>
      )}
    </div>
  );
}
