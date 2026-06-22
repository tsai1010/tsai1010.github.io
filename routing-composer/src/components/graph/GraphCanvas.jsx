import React, { useMemo, useRef, useState } from "react";
import GraphNode from "./GraphNode.jsx";
import { addEdgeSafe, edgeId } from "../../core/graphUtils.js";

const WORLD_W = 2400;
const WORLD_H = 1600;

function portPos(node, port) {
  const w = 132;
  const h = 66;
  if (port === "in") return { x: node.x + 12, y: node.y + h - 16 };
  return { x: node.x + w - 12, y: node.y + h - 16 };
}

function pathFor(a, b) {
  const dx = Math.max(60, Math.abs(b.x - a.x) * 0.45);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

export default function GraphCanvas({
  chain,
  selectedNodeId,
  selectedEdgeId,
  viewport,
  placing,
  locked = false,
  onViewport,
  onGraph,
  onSelectNode,
  onSelectEdge,
  onContextMenu,
  onNodeContextMenu,
  onPlaceModule,
  onCancelPlacing,
  onCanvasPointerDown,
}) {
  const wsRef = useRef(null);
  const dragRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [hoverPoint, setHoverPoint] = useState(null);

  const graph = chain?.graph || { nodes: [], edges: [] };
  const nodeMap = useMemo(() => new Map((graph.nodes || []).map((n) => [n.id, n])), [graph.nodes]);

  const screenToWorld = (clientX, clientY) => {
    const rect = wsRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - viewport.x) / viewport.zoom,
      y: (clientY - rect.top - viewport.y) / viewport.zoom,
    };
  };

  const setZoomAt = (nextZoom, clientX, clientY) => {
    const rect = wsRef.current.getBoundingClientRect();
    const z = Math.max(0.35, Math.min(1.8, nextZoom));
    const wx = (clientX - rect.left - viewport.x) / viewport.zoom;
    const wy = (clientY - rect.top - viewport.y) / viewport.zoom;
    onViewport({
      ...viewport,
      zoom: z,
      x: clientX - rect.left - wx * z,
      y: clientY - rect.top - wy * z,
    });
  };

  const updateNodePosition = (id, x, y) => {
    onGraph({
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
    }, { structure: false });
  };

  const handlePointerMove = (e) => {
    const p = screenToWorld(e.clientX, e.clientY);
    if (placing) setHoverPoint(p);

    const d = dragRef.current;
    if (!d) return;
    e.preventDefault();
    if (d.type === "pan") {
      onViewport({
        ...viewport,
        x: d.startVX + (e.clientX - d.startX),
        y: d.startVY + (e.clientY - d.startY),
      });
      return;
    }
    if (d.type === "node") {
      updateNodePosition(d.nodeId, p.x - d.offsetX, p.y - d.offsetY);
      return;
    }
    if (d.type === "wire") {
      setPreview({ from: d.from, fromPort: d.fromPort, toPoint: p });
    }
  };

  const stopDrag = () => {
    dragRef.current = null;
  };

  const startPan = (e) => {
    if (e.button !== 0 && e.button !== 1) return;

    // If a module type has been chosen, a plain left click places it instead of panning.
    if (!locked && placing && e.button === 0) {
      if (!e.target.closest?.(".rcg-node") && !e.target.closest?.(".rcg-port")) {
        e.preventDefault();
        const p = screenToWorld(e.clientX, e.clientY);
        onPlaceModule?.(placing.kind, { x: p.x - 66, y: p.y - 33 });
        return;
      }
    }

    onCanvasPointerDown?.(e);

    if (e.target.closest?.(".rcg-node") || e.target.closest?.(".rcg-port")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { type: "pan", startX: e.clientX, startY: e.clientY, startVX: viewport.x, startVY: viewport.y };
    onSelectNode(null);
    onSelectEdge(null);
  };

  const startNodeDrag = (e, nodeId) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const node = nodeMap.get(nodeId);
    const p = screenToWorld(e.clientX, e.clientY);
    if (locked) {
      onSelectNode(nodeId);
      onSelectEdge(null);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { type: "node", nodeId, offsetX: p.x - node.x, offsetY: p.y - node.y };
    onSelectNode(nodeId);
    onSelectEdge(null);
  };

  const startWire = (e, nodeId, port) => {
    e.stopPropagation();
    if (locked) return;
    const node = nodeMap.get(nodeId);
    if (!node || port !== "out") return;
    dragRef.current = { type: "wire", from: nodeId, fromPort: port };
    setPreview({ from: nodeId, fromPort: port, toPoint: portPos(node, port) });
  };

  const connectToTarget = (from, fromPort, targetId) => {
    if (locked) return;
    const target = nodeMap.get(targetId);
    if (!target) return;
    if (target.kind === "ks_source" || target.kind === "source") return;
    const next = addEdgeSafe(graph, { from, fromPort, to: targetId, toPort: "in" });
    onGraph(next, { structure: true });
  };

  const finishWire = (e, nodeId, port) => {
    e.stopPropagation();
    const d = dragRef.current;
    if (!d || d.type !== "wire") return;
    if (port === "in") connectToTarget(d.from, d.fromPort, nodeId);
    setPreview(null);
    dragRef.current = null;
  };

  const edgePaths = (graph.edges || []).map((edge) => {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);
    if (!from || !to) return null;
    const p1 = portPos(from, edge.fromPort || "out");
    const p2 = portPos(to, edge.toPort || "in");
    const id = edgeId(edge);
    return { edge, id, d: pathFor(p1, p2) };
  }).filter(Boolean);

  let previewPath = null;
  if (preview) {
    const from = nodeMap.get(preview.from);
    if (from) previewPath = pathFor(portPos(from, preview.fromPort || "out"), preview.toPoint);
  }

  const ghostPoint = hoverPoint || (placing ? screenToWorld((wsRef.current?.getBoundingClientRect().left || 0) + 160, (wsRef.current?.getBoundingClientRect().top || 0) + 120) : null);

  return (
    <div
      ref={wsRef}
      className={`rcg-workspace ${dragRef.current?.type === "pan" ? "is-panning" : ""}`}
      onPointerDown={startPan}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => {
        const d = dragRef.current;
        if (d?.type === "wire") {
          const doc = wsRef.current?.ownerDocument || document;
          const el = doc.elementFromPoint(e.clientX, e.clientY);
          const portEl = el?.closest?.(".rcg-port[data-port='in']");
          const nodeEl = el?.closest?.(".rcg-node");
          const targetId = portEl?.dataset?.nodeId || nodeEl?.dataset?.nodeId;
          if (targetId) connectToTarget(d.from, d.fromPort, targetId);
          setPreview(null);
        }
        stopDrag();
      }}
      onPointerCancel={() => { setPreview(null); stopDrag(); }}
      onWheel={(e) => {
        if (!e.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        const dir = e.deltaY > 0 ? 0.92 : 1.08;
        setZoomAt(viewport.zoom * dir, e.clientX, e.clientY);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (locked) return;
        const p = screenToWorld(e.clientX, e.clientY);
        onContextMenu?.(e, { type: "canvas", point: p });
      }}
    >
      <div className="rcg-grid" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }} />
      <div className="rcg-world" style={{ width: WORLD_W, height: WORLD_H, transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
        <svg className="rcg-edges" width={WORLD_W} height={WORLD_H}>
          {edgePaths.map(({ edge, id, d }) => (
            <g key={id}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (locked) return;
                onContextMenu?.(e, { type: "edge", edge });
              }}
              onClick={(e) => { e.stopPropagation(); onSelectEdge(id); onSelectNode(null); }}
            >
              <path className="rcg-edge-hit" d={d} />
              <path className={`rcg-edge ${selectedEdgeId === id ? "is-selected" : ""}`} d={d} />
            </g>
          ))}
          {previewPath && <path className="rcg-preview" d={previewPath} />}
        </svg>
        <div className="rcg-nodes">
          {graph.nodes.map((n) => (
            <GraphNode
              key={n.id}
              node={n}
              selected={selectedNodeId === n.id}
              onSelect={onSelectNode}
              onPointerDown={startNodeDrag}
              onPortPointerDown={startWire}
              onPortPointerUp={finishWire}
              onContextMenu={(e, node) => {
                if (locked) return;
                onNodeContextMenu?.(e, node);
              }}
            />
          ))}
        </div>
        {placing && ghostPoint && (
          <div className="rcg-ghost" style={{ left: ghostPoint.x - 66, top: ghostPoint.y - 33 }}>
            {placing.kind}
          </div>
        )}
      </div>
      <div className="rcg-hint">空白拖曳平移 · Alt + 滾輪縮放 · 拖 out 到模組方塊連線 · 右鍵空白新增</div>
    </div>
  );
}
