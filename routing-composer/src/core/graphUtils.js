// routing-composer/src/core/graphUtils.js
// -------------------------------------------------------------
// Small helpers for Routing Composer graph state.
// -------------------------------------------------------------

export function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function clone(obj) {
  return obj == null ? obj : JSON.parse(JSON.stringify(obj));
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function isGraphChain(chain) {
  return !!(
    chain &&
    typeof chain === "object" &&
    !Array.isArray(chain) &&
    chain.graph &&
    Array.isArray(chain.graph.nodes) &&
    Array.isArray(chain.graph.edges)
  );
}

export function getNode(graph, nodeId) {
  return graph?.nodes?.find((n) => n.id === nodeId) || null;
}

export function getIncomingEdges(graph, nodeId) {
  return (graph?.edges || []).filter((e) => e.to === nodeId);
}

export function getOutgoingEdges(graph, nodeId) {
  return (graph?.edges || []).filter((e) => e.from === nodeId);
}

export function edgeId(edge) {
  return edge.id || `${edge.from}:${edge.fromPort || "out"}->${edge.to}:${edge.toPort || "in"}`;
}

export function hasEdge(graph, from, to, fromPort = "out", toPort = "in") {
  return (graph?.edges || []).some(
    (e) =>
      e.from === from &&
      e.to === to &&
      (e.fromPort || "out") === fromPort &&
      (e.toPort || "in") === toPort
  );
}

export function wouldCreateCycle(graph, from, to) {
  if (!from || !to || from === to) return true;
  const adj = new Map();
  for (const e of graph?.edges || []) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e.to);
  }
  if (!adj.has(from)) adj.set(from, []);
  adj.get(from).push(to);

  const seen = new Set();
  const stack = new Set();

  const visit = (id) => {
    if (stack.has(id)) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    stack.add(id);
    for (const next of adj.get(id) || []) {
      if (visit(next)) return true;
    }
    stack.delete(id);
    return false;
  };

  for (const n of graph?.nodes || []) {
    if (visit(n.id)) return true;
  }
  return false;
}

export function addEdgeSafe(graph, edge) {
  const fromPort = edge.fromPort || "out";
  const toPort = edge.toPort || "in";
  if (!edge.from || !edge.to) return graph;
  if (edge.from === edge.to) return graph;
  if (hasEdge(graph, edge.from, edge.to, fromPort, toPort)) return graph;
  if (wouldCreateCycle(graph, edge.from, edge.to)) return graph;

  return {
    ...graph,
    edges: [
      ...(graph.edges || []),
      {
        id: edge.id || uid("edge"),
        from: edge.from,
        fromPort,
        to: edge.to,
        toPort,
      },
    ],
  };
}

export function removeNode(graph, nodeId) {
  return {
    ...graph,
    nodes: (graph.nodes || []).filter((n) => n.id !== nodeId),
    edges: (graph.edges || []).filter((e) => e.from !== nodeId && e.to !== nodeId),
  };
}

export function removeEdge(graph, edgeIdValue) {
  return {
    ...graph,
    edges: (graph.edges || []).filter((e) => edgeId(e) !== edgeIdValue && e.id !== edgeIdValue),
  };
}

export function topologicalSort(graph) {
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!indeg.has(e.from) || !indeg.has(e.to)) continue;
    indeg.set(e.to, indeg.get(e.to) + 1);
    adj.get(e.from).push(e.to);
  }
  const q = [];
  for (const [id, d] of indeg) if (d === 0) q.push(id);
  const out = [];
  while (q.length) {
    const id = q.shift();
    out.push(id);
    for (const to of adj.get(id) || []) {
      indeg.set(to, indeg.get(to) - 1);
      if (indeg.get(to) === 0) q.push(to);
    }
  }
  if (out.length !== nodes.length) return nodes.map((n) => n.id);
  return out;
}
