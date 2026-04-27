import { startTransition, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import GraphViewer from "../components/GraphViewer";
import { clearGraphError, requestGraph, selectGraphNode } from "../redux/slices/graphSlice";
import "./styles/Workspace.css";

function edgeNodeId(ep) {
  return typeof ep === "string" ? ep : ep?.id ?? "";
}

function GraphSkeleton() {
  return (
    <div className="ws-graph-skeleton">
      <div className="ws-skeleton-line ws-skeleton-line--short" />
      <div className="ws-skeleton-line ws-skeleton-line--wide" />
      <div className="ws-skeleton-line ws-skeleton-line--med" />
      <div className="ws-graph-skeleton__canvas" />
    </div>
  );
}

function NodeDetails({ node, relationships, connectedNodes, onSelectNode }) {
  if (!node) {
    return (
      <div className="ws-panel" style={{ height: "fit-content" }}>
        <div className="ws-panel__header">
          <span className="ws-eyebrow">Node details</span>
        </div>
        <div className="ws-panel__body" style={{ gap: "0.5rem" }}>
          <div className="ws-empty" style={{ minHeight: 160, padding: "1.5rem" }}>
            <span className="ws-empty__icon">🔍</span>
            <p>Click any node in the graph to inspect its relationships and importance score.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ws-panel">
      <div className="ws-panel__header">
        <span className="ws-eyebrow">Node details</span>
      </div>
      <div className="ws-panel__body">
        <div>
          <h3 style={{ fontFamily: "Syne, system-ui", fontWeight: 800, fontSize: "1.05rem", color: "#f8fafc", margin: "0 0 0.375rem" }}>{node.id}</h3>
          <p style={{ fontSize: "0.85rem", color: "#64748b", margin: 0, lineHeight: 1.6 }}>
            {node.description || "No additional description available yet."}
          </p>
        </div>

        <div className="ws-details-metrics">
          <div className="ws-details-metric">
            <span className="ws-details-metric__label">Importance</span>
            <span className="ws-details-metric__value">{Math.round((node.importance ?? 0) * 100)}%</span>
          </div>
          <div className="ws-details-metric">
            <span className="ws-details-metric__label">Category</span>
            <span className="ws-details-metric__value">{node.category || "concept"}</span>
          </div>
        </div>

        {relationships.length > 0 && (
          <div>
            <span className="ws-eyebrow" style={{ marginBottom: "0.5rem", display: "block" }}>Relationships</span>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
              {relationships.map((rel) => {
                const src = edgeNodeId(rel.source);
                const tgt = edgeNodeId(rel.target);
                return (
                  <div key={`${src}→${tgt}:${rel.label ?? ""}`} className="ws-rel-item">
                    <strong>{rel.label || "related"}</strong>
                    <span>{src} → {tgt}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {connectedNodes.length > 0 && (
          <div>
            <span className="ws-eyebrow" style={{ marginBottom: "0.5rem", display: "block" }}>Connected concepts</span>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
              {connectedNodes.map((n) => (
                <button key={n.id} className="ws-details-node-btn" onClick={() => onSelectNode(n.id)}>
                  <strong>{n.id}</strong>
                  <span>{Math.round((n.importance ?? 0) * 100)}%</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GraphPage() {
  const dispatch = useDispatch();
  const { nodes, edges, topic, selectedNodeId, status, error } = useSelector((s) => s.graph);
  const [topicInput, setTopicInput] = useState(() => topic ?? "");

  useEffect(() => {
    if (status === "idle") void dispatch(requestGraph(""));
  }, [dispatch, status]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const selectedRelationships = useMemo(
    () => edges.filter((e) => {
      const s = edgeNodeId(e.source), t = edgeNodeId(e.target);
      return s === selectedNodeId || t === selectedNodeId;
    }),
    [edges, selectedNodeId],
  );

  const connectedNodes = useMemo(() => {
    const ids = new Set(selectedRelationships.flatMap((r) => [edgeNodeId(r.source), edgeNodeId(r.target)]));
    ids.delete(selectedNodeId);
    return nodes.filter((n) => ids.has(n.id)).sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
  }, [nodes, selectedNodeId, selectedRelationships]);

  const handleSearch = (e) => {
    e.preventDefault();
    dispatch(clearGraphError());
    void dispatch(requestGraph(topicInput.trim()));
  };

  const handleFocusNode = (nodeId) => startTransition(() => dispatch(selectGraphNode(nodeId)));

  const hasNodes  = nodes.length > 0;
  const isLoading = status === "loading";

  return (
    <section className="workspace-page" style={{ padding: "0 1.5rem 2rem", maxWidth: 1280, margin: "0 auto" }}>

      {/* ── Page header ────────────────────────────────────────────────── */}
      <header className="ws-page-header">
        <div className="ws-page-header__copy">
          <span className="ws-eyebrow">Knowledge graph</span>
          <h1>Explore concepts as a connected system.</h1>
          <p>Hover to highlight relationships, click to inspect, zoom and pan across your full knowledge structure.</p>
        </div>
        <form className="ws-graph-search" onSubmit={handleSearch}>
          <label className="sr-only" htmlFor="graphSearch">Search graph node</label>
          <input
            id="graphSearch"
            type="search"
            className="ws-field__input"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            placeholder="Search a concept…"
            style={{ minWidth: 200 }}
          />
          <button type="submit" className="ws-btn ws-btn--primary" disabled={isLoading}>
            Focus
          </button>
        </form>
      </header>

      {/* ── Stats ──────────────────────────────────────────────────────── */}
      <div className="ws-stats">
        <div className="ws-stat">
          <span className="ws-stat__label">Nodes</span>
          <span className="ws-stat__value">{nodes.length}</span>
        </div>
        <div className="ws-stat">
          <span className="ws-stat__label">Relationships</span>
          <span className="ws-stat__value">{edges.length}</span>
        </div>
        <div className="ws-stat">
          <span className="ws-stat__label">Active topic</span>
          <span className="ws-stat__value" style={{ fontSize: "0.95rem" }}>{topic || "All"}</span>
        </div>
        <div className="ws-stat">
          <span className="ws-stat__label">Status</span>
          <span className="ws-stat__value" style={{ fontSize: "0.85rem", color: isLoading ? "#f59e0b" : "#5eead4" }}>
            {isLoading ? "Loading…" : "Ready"}
          </span>
        </div>
      </div>

      {/* ── Graph + details ────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.65fr) 300px", gap: "1rem", alignItems: "start" }}>

        {/* Graph canvas panel */}
        <div className="ws-panel" style={{ display: "flex", flexDirection: "column", minHeight: "72vh" }}>
          <div className="ws-panel__header">
            <div>
              <span className="ws-eyebrow" style={{ marginBottom: "0.25rem" }}>Interactive graph</span>
              <h2 className="ws-panel__title">Pan, zoom, inspect</h2>
            </div>
            <Link to="/ingest" className="ws-btn ws-btn--ghost" style={{ fontSize: "0.8rem" }}>+ Add data</Link>
          </div>

          <div style={{ flex: 1, position: "relative" }}>
            {isLoading && !hasNodes ? (
              <GraphSkeleton />
            ) : error && !hasNodes ? (
              <div className="ws-empty">
                <span className="ws-empty__icon">⚠️</span>
                <h3>Graph unavailable</h3>
                <p>{error}</p>
                <button type="button" className="ws-btn ws-btn--ghost" onClick={() => void dispatch(requestGraph(topic))}>Retry</button>
              </div>
            ) : !hasNodes ? (
              <div className="ws-empty">
                <span className="ws-empty__icon">🕸️</span>
                <h3>No graph data yet</h3>
                <p>Ingest a source first, then come back to explore the resulting concepts and relationships.</p>
                <Link to="/ingest" className="ws-btn ws-btn--primary">Ingest a source →</Link>
              </div>
            ) : (
              <>
                {error && (
                  <div className="ws-banner ws-banner--error" style={{ margin: "1rem" }} role="alert">
                    <span>{error}</span>
                    <button type="button" className="ws-btn ws-btn--ghost" style={{ fontSize: "0.8rem" }} onClick={() => void dispatch(requestGraph(topic))}>Retry</button>
                  </div>
                )}
                <GraphViewer
                  graphData={{ nodes, edges }}
                  selectedNodeId={selectedNodeId}
                  onNodeSelect={(node) => handleFocusNode(node.id)}
                />
              </>
            )}
          </div>
        </div>

        {/* Details panel */}
        <NodeDetails
          node={selectedNode}
          relationships={selectedRelationships}
          connectedNodes={connectedNodes}
          onSelectNode={handleFocusNode}
        />
      </div>
    </section>
  );
}

export default GraphPage;