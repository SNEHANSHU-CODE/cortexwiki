import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useTheme } from "../hooks/useTheme";
import "./styles/GraphViewer.css";

// ── Helpers ────────────────────────────────────────────────────────────────

function getNodeId(node) {
  return typeof node === "string" ? node : (node?.id ?? "");
}

function hashString(value) {
  return [...value].reduce((acc, ch, i) => acc + ch.charCodeAt(0) * (i + 1) * 31, 0);
}

function seedPosition(id, index, total) {
  const angle  = ((hashString(id) + index * 37) % 360) * (Math.PI / 180);
  const radius = 90 + ((index % Math.max(4, total)) * 22);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

// Node color palette — matches landing page DNA
const NODE_COLORS = {
  active:      "#f59e0b",   // amber — selected
  highlighted: "#5eead4",   // teal  — adjacent to active
  core:        "#38bdf8",   // cyan  — core category
  default:     "#0f766e",   // dark teal — everything else
};

// ── Component ──────────────────────────────────────────────────────────────

function GraphViewer({ graphData, selectedNodeId, onNodeSelect, wikiId }) {
  const { theme } = useTheme();
  const containerRef  = useRef(null);
  const graphRef      = useRef(null);
  const hasAutoFitRef = useRef(false);

  const [hoveredNodeId, setHoveredNodeId] = useState("");
  // Bug 2 fix: Read dimensions synchronously on mount via useLayoutEffect so the
  // graph canvas is never blocked by a late-firing async ResizeObserver.
  const [size, setSize] = useState({ width: 0, height: 0 });

  // ── Synchronous size seed on mount ───────────────────────────────────────
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setSize({ width: rect.width, height: rect.height });
    }
  }, []);

  // ── ResizeObserver — keeps size in sync on layout changes ────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ── Normalize — only recomputes when source data changes ─────────────────
  const normalizedData = useMemo(() => {
    let loadedPositions = new Map();
    try {
      const key = wikiId ? `graph:positions:cache:${wikiId}` : "graph:positions:cache";
      const stored = typeof window !== "undefined" ? localStorage.getItem(key) : null;
      if (stored) {
        const data = JSON.parse(stored);
        loadedPositions = new Map(Object.entries(data));
      }
    } catch (err) {
      console.warn("Failed to load persisted graph positions:", err);
    }

    const total = graphData.nodes.length || 1;
    return {
      nodes: graphData.nodes.map((node, i) => ({
        ...node,
        ...(loadedPositions.get(node.id) ?? seedPosition(node.id, i, total)),
      })),
      links: graphData.edges.map((edge) => ({
        ...edge,
        id: `${getNodeId(edge.source)}::${getNodeId(edge.target)}::${edge.label ?? ""}`,
      })),
    };
  }, [graphData.nodes, graphData.edges, wikiId]);

  // ── Adjacency map ────────────────────────────────────────────────────────
  const adjacencyMap = useMemo(() => {
    const map = new Map();
    normalizedData.nodes.forEach((n) => map.set(n.id, new Set([n.id])));
    normalizedData.links.forEach((link) => {
      const src = getNodeId(link.source);
      const tgt = getNodeId(link.target);
      if (!map.has(src)) map.set(src, new Set([src]));
      if (!map.has(tgt)) map.set(tgt, new Set([tgt]));
      map.get(src).add(tgt);
      map.get(tgt).add(src);
    });
    return map;
  }, [normalizedData.nodes, normalizedData.links]);

  const activeNodeId       = hoveredNodeId || selectedNodeId;
  const highlightedNodeIds = useMemo(
    () => adjacencyMap.get(activeNodeId) ?? (activeNodeId ? new Set([activeNodeId]) : new Set()),
    [activeNodeId, adjacencyMap],
  );

  const highlightedLinks = useMemo(() => {
    if (!activeNodeId) return new Set();
    return new Set(
      normalizedData.links
        .filter((l) => {
          const src = getNodeId(l.source);
          const tgt = getNodeId(l.target);
          return src === activeNodeId || tgt === activeNodeId;
        })
        .map((l) => l.id),
    );
  }, [activeNodeId, normalizedData.links]);

  // ── Center on selected node ──────────────────────────────────────────────
  useEffect(() => {
    if (!selectedNodeId || !graphRef.current) return;
    const node = normalizedData.nodes.find((n) => n.id === selectedNodeId);
    if (!node) return;
    graphRef.current.centerAt(node.x ?? 0, node.y ?? 0, 500);
    graphRef.current.zoom(2.5, 700);
  }, [selectedNodeId, normalizedData.nodes]);

  // ── Center on graph load (initial data) ────────────────────────────────────
  useEffect(() => {
    hasAutoFitRef.current = false;
  }, [graphData.nodes, graphData.edges]);

  useEffect(() => {
    if (!graphRef.current || normalizedData.nodes.length === 0) return;
    if (selectedNodeId) return;
    if (size.width <= 0 || size.height <= 0) return;
    if (hasAutoFitRef.current) return;

    hasAutoFitRef.current = true;
    requestAnimationFrame(() => {
      if (!graphRef.current) return;
      // Fit to the visible viewport of the component on first paint.
      graphRef.current.zoomToFit(500, 64);
    });
  }, [normalizedData.nodes.length, selectedNodeId, size.width, size.height]);

  // ── Forces — configured when normalizedData changes ──────────────────────
  const configureForces = useCallback(() => {
    const g = graphRef.current;
    if (!g) return;
    g.d3Force("charge")?.strength?.(-180);
    g.d3Force("link")?.distance?.((link) => {
      const src = typeof link.source === "object" ? link.source : normalizedData.nodes.find((n) => n.id === link.source);
      const tgt = typeof link.target === "object" ? link.target : normalizedData.nodes.find((n) => n.id === link.target);
      const imp = Math.max(src?.importance ?? 0.3, tgt?.importance ?? 0.3);
      return 125 - imp * 32;
    });
  }, [normalizedData.nodes]);

  useEffect(() => {
    configureForces();
  }, [normalizedData, configureForces]);

  // ── Persist positions ─────────────────────────────────────────────────────
  const persistPositions = useCallback(() => {
    const data = {};
    normalizedData.nodes.forEach((node) => {
      data[node.id] = {
        x: node.x ?? 0, y: node.y ?? 0,
        vx: node.vx ?? 0, vy: node.vy ?? 0,
      };
    });
    try {
      const key = wikiId ? `graph:positions:cache:${wikiId}` : "graph:positions:cache";
      localStorage.setItem(key, JSON.stringify(data));
    } catch (err) {
      console.warn("Failed to persist graph positions:", err);
    }
  }, [normalizedData.nodes, wikiId]);

  const persistPositionsRef = useRef(persistPositions);
  useEffect(() => {
    persistPositionsRef.current = persistPositions;
  }, [persistPositions]);

  const handleNodeDragEnd = useCallback((node) => {
    node.fx = node.x;
    node.fy = node.y;
    persistPositionsRef.current();
  }, []);

  // ── Canvas painter ────────────────────────────────────────────────────────
  const paintNode = useCallback((node, ctx, globalScale) => {
    const isActive      = activeNodeId === node.id;
    const isHighlighted = highlightedNodeIds.has(node.id);
    const radius        = 5 + Math.round((node.importance ?? 0.5) * 11);
    const fontSize      = Math.max(11 / globalScale, 3.5);
    const showLabel     = globalScale > 1.1 || isHighlighted || isActive;

    // Glow for active node
    if (isActive) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 6, 0, 2 * Math.PI, false);
      const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, radius + 6);
      glow.addColorStop(0, theme === "light" ? "rgba(15, 98, 254, 0.2)" : "rgba(245, 158, 11, 0.3)");
      glow.addColorStop(1, theme === "light" ? "rgba(15, 98, 254, 0)" : "rgba(245, 158, 11, 0)");
      ctx.fillStyle = glow;
      ctx.fill();
    }

    // Node circle
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = isActive
      ? (theme === "light" ? "#0f62fe" : NODE_COLORS.active)
      : isHighlighted
      ? (theme === "light" ? "#0f766e" : NODE_COLORS.highlighted)
      : node.category === "core"
      ? (theme === "light" ? "#0284c7" : NODE_COLORS.core)
      : (theme === "light" ? "#64748b" : NODE_COLORS.default);
    ctx.fill();

    // Subtle ring on highlighted
    if (isHighlighted && !isActive) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 1.5, 0, 2 * Math.PI, false);
      ctx.strokeStyle = theme === "light" ? "rgba(15, 118, 110, 0.4)" : "rgba(94, 234, 212, 0.4)";
      ctx.lineWidth   = 1;
      ctx.stroke();
    }

    if (!showLabel) return;

    // Label
    const label     = node.id;
    const textX     = node.x + radius + 6;
    const textY     = node.y + fontSize / 3;
    ctx.font        = `600 ${fontSize}px IBM Plex Mono, monospace`;
    const textWidth = ctx.measureText(label).width;
    const pad       = 5;

    ctx.fillStyle = theme === "light" ? "rgba(255, 255, 255, 0.94)" : "rgba(10, 15, 30, 0.82)";
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(textX - pad, node.y - fontSize * 0.75, textWidth + pad * 2, fontSize * 1.6, 3);
    } else {
      ctx.rect(textX - pad, node.y - fontSize * 0.75, textWidth + pad * 2, fontSize * 1.6);
    }
    ctx.fill();

    ctx.fillStyle = isActive
      ? (theme === "light" ? "#0f62fe" : "#fde68a")
      : isHighlighted
      ? (theme === "light" ? "#0f766e" : "#5eead4")
      : (theme === "light" ? "#0f172a" : "#cbd5e1");
    ctx.fillText(label, textX, textY);
  }, [activeNodeId, highlightedNodeIds, theme]);

  return (
    <div
      className="graph-viewer"
      ref={containerRef}
      role="img"
      aria-label="Interactive knowledge graph — click nodes to inspect relationships"
    >
      {size.width > 0 && size.height > 0 && (
        <ForceGraph2D
          ref={graphRef}
          width={size.width}
          height={size.height}
          graphData={normalizedData}
          backgroundColor="transparent"
          cooldownTicks={180}
          onEngineStop={() => persistPositionsRef.current()}
          linkWidth={(l)                    => highlightedLinks.has(l.id) ? 2.5 : 0.9}
          linkColor={(l)                    => highlightedLinks.has(l.id) ? (theme === "light" ? "rgba(15, 98, 254, 0.85)" : "rgba(94, 234, 212, 0.85)") : (theme === "light" ? "rgba(15, 23, 42, 0.15)" : "rgba(148, 163, 184, 0.2)")}
          linkDirectionalParticles={(l)     => highlightedLinks.has(l.id) ? 3 : 0}
          linkDirectionalParticleWidth={(l) => highlightedLinks.has(l.id) ? 2.5 : 0}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          linkCurvature={0.12}
          nodeCanvasObject={paintNode}
          onNodeClick={(node)   => onNodeSelect?.(node)}
          onNodeHover={(node)   => setHoveredNodeId(node?.id ?? "")}
          onNodeDragEnd={handleNodeDragEnd}
          onBackgroundClick={()  => setHoveredNodeId("")}
        />
      )}
    </div>
  );
}

export default memo(GraphViewer);
