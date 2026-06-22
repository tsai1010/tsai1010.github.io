// routing-composer/src/core/graphMigration.js
// -------------------------------------------------------------
// v1 linear chain <-> v2 graph conversion helpers.
// -------------------------------------------------------------

import { uid, isGraphChain, clone } from "./graphUtils.js";
import { linearLayout } from "./graphLayout.js";

export const GRAPH_VERSION = 2;

export const DEFAULT_PARAMS = {
  ks_source: {
    smoothingMode: "auto",
    smoothingFactor: 0.2,
    autoSmoothingProfile: "steel",
    smoothingOffset: 0.0,
    velScale: 1.0,
    ksDurSec: 1.0,
    ksRelease: 0.5,
    seedNoiseType: "pink",
    useSynthA4: true,
  },
  source: {
    type: "sawtooth",
    level: 0.15,
    adsr: { a: 0.003, d: 0.08, s: 0.4, r: 0.2 },
  },
  filter: { mode: "lowpass", freq: 1200, q: 0.7 },
  delay: { time: 0.25, feedback: 0.35, mix: 0.3 },
  reverb: { decay: 2.0, mix: 0.25 },
  convolver_ir: { irId: "IR_Gibson", mix: 0.3 },
  gain: { gain: 0.8 },
  analyzer: {},
  output: {},
};

export function normalizeGraphNode(raw, idx = 0) {
  const kind = raw?.kind || "gain";
  return {
    id: raw?.id || uid(kind),
    kind,
    x: Number.isFinite(Number(raw?.x)) ? Number(raw.x) : 120 + idx * 180,
    y: Number.isFinite(Number(raw?.y)) ? Number(raw.y) : 200,
    enabled: raw?.enabled !== false,
    params: {
      ...(DEFAULT_PARAMS[kind] || {}),
      ...(raw?.params && typeof raw.params === "object" ? raw.params : {}),
    },
  };
}

function extractChainRouting(modules = []) {
  const source = modules.find((m) => m?.kind === "ks_source" || m?.kind === "source");
  const p = source?.params || {};
  return {
    ch: p.ch ?? "all",
    program: p.program ?? "all",
  };
}

function stripChainRoutingParams(mod) {
  const out = clone(mod);
  if (out?.params && (out.kind === "ks_source" || out.kind === "source")) {
    delete out.params.ch;
    delete out.params.program;
  }
  return out;
}

export function linearChainToGraphChain(chain, opts = {}) {
  const modules = Array.isArray(chain) ? chain.filter((m) => m && typeof m.kind === "string") : [];
  const positions = linearLayout(modules.length + 1);
  const routing = extractChainRouting(modules);

  const nodes = modules.map((m, idx) => {
    const clean = stripChainRoutingParams(m);
    return normalizeGraphNode({
      ...clean,
      x: positions[idx].x,
      y: positions[idx].y,
    }, idx);
  });

  const outputId = uid("out");
  nodes.push({
    id: outputId,
    kind: "output",
    x: positions[modules.length].x,
    y: positions[modules.length].y,
    enabled: true,
    params: {},
  });

  const edges = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      id: uid("edge"),
      from: nodes[i].id,
      fromPort: "out",
      to: nodes[i + 1].id,
      toPort: "in",
    });
  }

  return {
    id: opts.id || uid("chain"),
    name: opts.name || "Chain",
    muted: !!opts.mute,
    locked: !!opts.locked,
    ch: routing.ch,
    program: routing.program,
    gain: Number.isFinite(Number(opts.gain)) ? Number(opts.gain) : 1,
    graph: { nodes, edges },
  };
}

export function normalizeGraphChain(raw, idx = 0) {
  if (Array.isArray(raw)) {
    return linearChainToGraphChain(raw, { name: `Chain ${idx + 1}` });
  }

  if (!isGraphChain(raw)) {
    return linearChainToGraphChain([], { name: raw?.name || `Chain ${idx + 1}` });
  }

  const nodes = (raw.graph.nodes || []).map(normalizeGraphNode);
  const hasOutput = nodes.some((n) => n.kind === "output");
  if (!hasOutput) {
    nodes.push({ id: uid("out"), kind: "output", x: 820, y: 200, enabled: true, params: {} });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = (raw.graph.edges || [])
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
    .map((e) => ({
      id: e.id || uid("edge"),
      from: e.from,
      fromPort: e.fromPort || "out",
      to: e.to,
      toPort: e.toPort || "in",
    }));

  return {
    id: raw.id || uid("chain"),
    name: raw.name || raw?.meta?.name || `Chain ${idx + 1}`,
    muted: !!(raw.muted ?? raw.mute),
    locked: !!(raw.locked ?? raw?.meta?.locked),
    ch: raw.ch ?? "all",
    program: raw.program ?? "all",
    gain: Number.isFinite(Number(raw.gain)) ? Number(raw.gain) : 1,
    graph: { nodes, edges },
  };
}

export function normalizeGraphState(json) {
  if (!json) return null;

  // v1 direct array: Array<Array<Module>>
  if (Array.isArray(json) && Array.isArray(json[0])) {
    return {
      version: GRAPH_VERSION,
      chains: json.map((c, i) => linearChainToGraphChain(c, { name: `Chain ${i + 1}` })),
      global: null,
      ui: {},
    };
  }

  const rawChains = Array.isArray(json.chains) ? json.chains : [];
  const meta = Array.isArray(json.chainMeta) ? json.chainMeta : [];
  const mutes = Array.isArray(json.mutes) ? json.mutes : [];

  const chains = rawChains.map((c, idx) => {
    if (Array.isArray(c)) {
      return linearChainToGraphChain(c, {
        name: meta[idx]?.name || `Chain ${idx + 1}`,
        locked: meta[idx]?.locked,
        mute: mutes[idx],
      });
    }
    const gc = normalizeGraphChain(c, idx);
    if (meta[idx]?.name && !c.name) gc.name = meta[idx].name;
    if (typeof meta[idx]?.locked === "boolean" && c.locked == null) gc.locked = meta[idx].locked;
    if (typeof mutes[idx] === "boolean" && c.muted == null && c.mute == null) gc.muted = mutes[idx];
    return gc;
  });

  if (!chains.length) {
    chains.push(linearChainToGraphChain([
      { kind: "ks_source", params: { ...DEFAULT_PARAMS.ks_source } },
      { kind: "gain", params: { ...DEFAULT_PARAMS.gain } },
      { kind: "analyzer", params: {} },
    ], { name: "Main KS" }));
  }

  return {
    version: GRAPH_VERSION,
    chains,
    global: json.global || null,
    ui: json.ui || {},
  };
}

export function graphChainToLinearChain(chain) {
  // Best-effort export for old systems: topological order, excluding output.
  const graph = chain?.graph || { nodes: [], edges: [] };
  const nodes = graph.nodes || [];
  return nodes
    .filter((n) => n.kind !== "output")
    .map((n) => ({
      id: n.id,
      kind: n.kind,
      enabled: n.enabled !== false,
      params: {
        ...(n.params || {}),
        ...(n.kind === "ks_source" || n.kind === "source"
          ? { ch: chain.ch ?? "all", program: chain.program ?? "all" }
          : {}),
      },
    }));
}
