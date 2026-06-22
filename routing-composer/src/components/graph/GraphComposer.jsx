import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import ChainTabs from "./ChainTabs.jsx";
import GraphCanvas from "./GraphCanvas.jsx";
import GraphInspector from "./GraphInspector.jsx";
import GraphToolbar from "./GraphToolbar.jsx";
import { createPopoutBridge, isGraphPopout } from "./PopoutBridge.js";
import { DEFAULT_PARAMS, normalizeGraphState, normalizeGraphChain, linearChainToGraphChain, graphChainToLinearChain } from "../../core/graphMigration.js";
import { AudioEngine } from "../../core/AudioEngine.js";
import { clone, edgeId, removeEdge, removeNode, uid } from "../../core/graphUtils.js";

const MODULES = ["ks_source", "source", "filter", "delay", "gain", "convolver_ir", "reverb", "analyzer"];

function makeDefaultState() {
  return normalizeGraphState({
    version: 2,
    chains: [
      linearChainToGraphChain([
        { kind: "ks_source", params: { ...DEFAULT_PARAMS.ks_source } },
        { kind: "gain", params: { ...DEFAULT_PARAMS.gain } },
      ], { name: "Main KS" }),
    ],
    global: null,
  });
}

function uniquifyGraphChainIds(chain, idx = 0) {
  if (!chain?.graph) return chain;
  const prefix = `c${idx}_`;
  const used = new Set();
  const idMap = new Map();

  const nodes = (chain.graph.nodes || []).map((node) => {
    const oldId = String(node.id || uid(node.kind || "node"));
    let nextId = oldId.startsWith(prefix) ? oldId : `${prefix}${oldId}`;
    while (used.has(nextId)) nextId = `${prefix}${uid(node.kind || "node")}`;
    used.add(nextId);
    idMap.set(oldId, nextId);
    return { ...node, id: nextId };
  });

  const edges = (chain.graph.edges || [])
    .map((edge) => {
      const from = idMap.get(String(edge.from)) || edge.from;
      const to = idMap.get(String(edge.to)) || edge.to;
      if (!used.has(from) || !used.has(to)) return null;
      return {
        ...edge,
        id: edge.id ? `${prefix}${edge.id}` : uid("edge"),
        from,
        to,
        fromPort: edge.fromPort || "out",
        toPort: edge.toPort || "in",
      };
    })
    .filter(Boolean);

  return {
    ...chain,
    id: chain.id || uid("chain"),
    graph: { nodes, edges },
  };
}

function uniquifyGraphStateIds(state) {
  if (!state?.chains) return state;
  return {
    ...state,
    chains: state.chains.map((chain, idx) => uniquifyGraphChainIds(chain, idx)),
  };
}

function getInitialState(initialState) {
  return uniquifyGraphStateIds(normalizeGraphState(initialState) || makeDefaultState());
}

function fitViewport(chain, width = 900, height = 520) {
  const nodes = chain?.graph?.nodes || [];
  if (!nodes.length) return { x: 80, y: 80, zoom: 1 };
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + 150));
  const maxY = Math.max(...nodes.map((n) => n.y + 90));
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const z = Math.max(0.4, Math.min(1.25, Math.min((width - 120) / w, (height - 100) / h)));
  return { x: 60 - minX * z, y: 70 - minY * z, zoom: z };
}

function smoothSetAudioParam(param, value, time = 0.015) {
  if (!param) return;
  const ctx = param.context || null;
  const now = ctx?.currentTime ?? 0;
  try {
    param.cancelScheduledValues(now);
    const cur = Number(param.value);
    param.setValueAtTime(Number.isFinite(cur) ? cur : Number(value), now);
    param.setTargetAtTime(Number(value), now, time);
  } catch {
    try { param.value = Number(value); } catch {}
  }
}

export default function GraphComposer({ synth, initialState, onChange, embedded = false, popoutWindow = false }) {
  const isPop = isGraphPopout();
  const isRemoteView = isPop || popoutWindow;
  const initialRef = useRef(null);
  if (!initialRef.current) initialRef.current = getInitialState(initialState);
  const [state, setState] = useState(() => initialRef.current);
  const [open, setOpen] = useState(isPop || embedded);
  const [activeId, setActiveId] = useState(() => initialRef.current.chains[0]?.id);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [viewport, setViewport] = useState({ x: 80, y: 80, zoom: 1 });
  const [menu, setMenu] = useState(null);
  const [ioMenu, setIoMenu] = useState(null);
  const [placing, setPlacing] = useState(null);
  const bridgeRef = useRef(null);
  const fileInputRef = useRef(null);
  const importModeRef = useRef("all");
  const popoutRootRef = useRef(null);
  const sourceIdRef = useRef(uid("view"));
  const engineRef = useRef(null);
  // Only the main/mini editor owns the real AudioEngine.
  // Popout is a remote controller view; creating an engine there overwrites
  // window.__RC_HANDLE__ and disconnects MIDI routing in the main page.
  if (!isRemoteView && !engineRef.current) engineRef.current = new AudioEngine();
  const engine = engineRef.current;
  const localChangeRef = useRef(false);
  const didInitialBroadcastRef = useRef(false);
  const sliderFrameRef = useRef(null);
  const stateRef = useRef(state);
  const activeIdRef = useRef(activeId);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  function normalizeLoadedChainJson(json, idx = 0, opts = {}) {
    const existing = stateRef.current?.chains?.[idx];

    // Legacy single-chain formats:
    //   [module, module, ...]
    //   { chain:[...], meta:{...}, mute:false }
    // Graph formats:
    //   { version:2, chain:{...} }
    //   { graph:{nodes,edges}, ... }
    const rawChain = Array.isArray(json) ? json : (json?.chain ?? json);

    let chain;
    if (Array.isArray(rawChain)) {
      chain = linearChainToGraphChain(rawChain, {
        name: opts.name || json?.meta?.name || existing?.name || `Chain ${idx + 1}`,
        mute: opts.mute ?? json?.mute ?? existing?.muted ?? false,
        locked: opts.locked ?? json?.meta?.locked ?? existing?.locked ?? false,
        gain: opts.gain ?? existing?.gain ?? 1,
      });
    } else {
      chain = normalizeGraphChain(rawChain, idx);
    }

    if (!chain) throw new Error("Invalid chain JSON");

    const withMeta = {
      ...chain,
      id: existing?.id || chain.id || uid("chain"),
      name: opts.name || json?.meta?.name || chain.name || existing?.name || `Chain ${idx + 1}`,
      locked: Boolean(opts.locked ?? json?.meta?.locked ?? chain.locked ?? existing?.locked ?? false),
      muted: Boolean(opts.mute ?? json?.mute ?? chain.muted ?? existing?.muted ?? false),
      gain: Number.isFinite(Number(opts.gain ?? chain.gain ?? existing?.gain))
        ? Number(opts.gain ?? chain.gain ?? existing?.gain)
        : 1,
    };

    // Important: legacy presets often contain stable module ids.
    // Loading the same preset into multiple chains would otherwise collide in AudioEngine.liveNodes.
    return uniquifyGraphChainIds(withMeta, idx);
  }

  async function loadFullRoutingFromURL(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const next = getInitialState(json);
    commitState(next);
    setActiveId(next.chains[0]?.id);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    return next;
  }

  async function loadChainFromURL(idx, url, opts = {}) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const chain = normalizeLoadedChainJson(json, idx, opts);

    commitState((prev) => {
      const chains = prev.chains.slice();
      while (chains.length <= idx) {
        chains.push(linearChainToGraphChain([], { name: `Chain ${chains.length + 1}` }));
      }
      chains[idx] = chain;
      return { ...prev, version: 2, chains };
    });

    setActiveId(chain.id);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    return chain;
  }

  function setChainMetaByIndex(idx, patch = {}) {
    commitState((prev) => ({
      ...prev,
      chains: prev.chains.map((c, i) => {
        if (i !== idx) return c;
        return {
          ...c,
          ...(typeof patch.name === "string" ? { name: patch.name } : {}),
          ...(typeof patch.locked === "boolean" ? { locked: patch.locked } : {}),
        };
      }),
    }));
  }

  function setChainMuteByIndex(idx, muted) {
    commitState((prev) => ({
      ...prev,
      chains: prev.chains.map((c, i) => (i === idx ? { ...c, muted: !!muted } : c)),
    }));
  }

  function setChainGainByIndex(idx, gain) {
    const nextGain = Number(gain);
    if (!Number.isFinite(nextGain)) return;
    commitState((prev) => ({
      ...prev,
      chains: prev.chains.map((c, i) => (i === idx ? { ...c, gain: nextGain } : c)),
    }));
  }

  useEffect(() => {
    if (isRemoteView) return;
    try {
      if (synth && engine && typeof engine.setMidiSynth === "function") engine.setMidiSynth(synth);
      window.__RC_HANDLE__ = {
        ...(window.__RC_HANDLE__ || {}),
        engine,
        midi: (data) => engine?.handleMIDIMsg?.(data),
        getState: () => stateRef.current,
        loadFromURL: loadFullRoutingFromURL,
        loadChainFromURL,
        setChainMeta: setChainMetaByIndex,
        setChainMute: setChainMuteByIndex,
        setChainGain: setChainGainByIndex,
      };
      if (synth) synth.audioEngine = engine;
    } catch (e) {
      console.warn("[RCG] engine setup failed", e);
    }
  }, [synth, engine, isRemoteView]);

  // Apply global values when they arrive from popout/import.
  useEffect(() => {
    if (isRemoteView || !synth) return;
    const g = stateRef.current?.global || {};
    if (typeof g.a4 === "number" && Number.isFinite(g.a4)) {
      if (typeof synth.setA4freq === "function") synth.setA4freq(g.a4);
      else synth.a4_freq = g.a4;
    }
    if (typeof g.masterVol === "number" && Number.isFinite(g.masterVol)) {
      if (typeof synth.setMasterVol === "function") synth.setMasterVol(g.masterVol);
      else synth.masterVol = g.masterVol;
    }
  }, [state.global?.a4, state.global?.masterVol, synth, isRemoteView]);

  const activeChain = state.chains.find((c) => c.id === activeId) || state.chains[0];
  const selectedNode = activeChain?.graph?.nodes?.find((n) => n.id === selectedNodeId) || null;
  const selectedEdge = (activeChain?.graph?.edges || []).find((e) => edgeId(e) === selectedEdgeId || e.id === selectedEdgeId) || null;

  useEffect(() => {
    bridgeRef.current = createPopoutBridge(`routing-composer-graph-${location.pathname}`);
    const off = bridgeRef.current.on((msg) => {
      if (!msg || msg.source === sourceIdRef.current) return;
      if (msg.type === "state" && msg.state) {
        localChangeRef.current = true;
        setState(msg.state);
        if (msg.activeId) setActiveId(msg.activeId);
      }
      if (msg.type === "request-state" && !isPop && !popoutWindow) {
        bridgeRef.current?.post({
          type: "state",
          state: stateRef.current,
          activeId: activeIdRef.current,
          source: sourceIdRef.current,
        });
      }
    });
    if (isRemoteView) bridgeRef.current.post({ type: "request-state", source: sourceIdRef.current });
    return () => {
      off();
      bridgeRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (localChangeRef.current) {
      localChangeRef.current = false;
      didInitialBroadcastRef.current = true;
      return;
    }

    // Pop-out starts from a copy of state; do not let its initial mount overwrite the main page.
    if (isRemoteView && !didInitialBroadcastRef.current) {
      didInitialBroadcastRef.current = true;
      return;
    }

    didInitialBroadcastRef.current = true;
    onChange?.(state);
    bridgeRef.current?.post({ type: "state", state, activeId, source: sourceIdRef.current });
  }, [state, activeId]);

  // Apply graph changes to AudioEngine. Structural changes rebuild the active chain only.
  useEffect(() => {
    if (isRemoteView || !engine || !activeChain) return;
    try {
      if (typeof engine.buildGraphMany === "function") {
        engine.buildGraphMany(state.chains);
      } else if (typeof engine.buildGraph === "function") {
        engine.buildGraph(activeChain, state.chains.findIndex((c) => c.id === activeChain.id));
      }
    } catch (e) {
      console.warn("[RCG] buildGraph failed", e);
    }
  }, [state.chains.map((c) => `${c.id}:${c.muted}:${c.locked}:${c.ch}:${c.program}:${c.gain}:${c.graph.nodes.map(n => `${n.id},${n.kind},${n.enabled !== false}`).join(";")}:${c.graph.edges.map(e => `${e.from}->${e.to}`).join(";")}`).join("|")]);

  const commitState = (updater) => {
    setState((prev) => typeof updater === "function" ? updater(prev) : updater);
  };

  const updateActiveChain = (fn, opts = {}) => {
    if (activeChain?.locked && !opts.allowLocked) return;
    commitState((prev) => ({
      ...prev,
      chains: prev.chains.map((c) => c.id === activeChain.id ? fn(c) : c),
    }));
  };

  const updateGraph = (graph, meta = {}) => {
    updateActiveChain((c) => ({ ...c, graph }));
  };

  const patchNode = (nodeId, patch) => {
    updateActiveChain((c) => ({
      ...c,
      graph: {
        ...c.graph,
        nodes: c.graph.nodes.map((n) => n.id === nodeId ? { ...n, ...patch } : n),
      },
    }));
  };

  const patchNodeParam = (nodeId, key, value) => {
    if (activeChain?.locked) return;
    // Update WebAudio params immediately and smoothly, then update serializable state.
    if (engine?.updateGraphNodeParam) {
      engine.updateGraphNodeParam(nodeId, key, value);
    }

    // UI/state update is throttled to animation frame to reduce slider zipper/click artifacts.
    cancelAnimationFrame(sliderFrameRef.current);
    sliderFrameRef.current = requestAnimationFrame(() => {
      updateActiveChain((c) => ({
        ...c,
        graph: {
          ...c.graph,
          nodes: c.graph.nodes.map((n) => n.id === nodeId ? {
            ...n,
            params: { ...(n.params || {}), [key]: value },
          } : n),
        },
      }));
    });
  };

  const addChain = () => {
    const chain = linearChainToGraphChain([], { name: `Chain ${state.chains.length + 1}` });
    commitState((prev) => ({ ...prev, chains: [...prev.chains, chain] }));
    setActiveId(chain.id);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  };

  const deleteChain = (chainId) => {
    const target = state.chains.find((c) => c.id === chainId);
    if (!target || target.locked || state.chains.length <= 1) return;
    const idx = state.chains.findIndex((c) => c.id === chainId);
    const nextActive = state.chains[idx + 1]?.id || state.chains[idx - 1]?.id || state.chains[0]?.id;
    commitState((prev) => ({
      ...prev,
      chains: prev.chains.filter((c) => c.id !== chainId),
    }));
    setActiveId(nextActive);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  };

  const addModuleAt = (kind, point) => {
    if (activeChain?.locked) return;
    const node = {
      id: uid(kind),
      kind,
      x: point.x,
      y: point.y,
      enabled: true,
      params: clone(DEFAULT_PARAMS[kind] || {}),
    };
    updateActiveChain((c) => ({ ...c, graph: { ...c.graph, nodes: [...c.graph.nodes, node] } }));
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  };

  const deleteNode = (nodeId) => {
    if (activeChain?.locked) return;
    updateActiveChain((c) => ({ ...c, graph: removeNode(c.graph, nodeId) }));
    setSelectedNodeId(null);
  };

  const deleteEdge = (id) => {
    if (activeChain?.locked) return;
    updateActiveChain((c) => ({ ...c, graph: removeEdge(c.graph, id) }));
    setSelectedEdgeId(null);
  };

  useEffect(() => {
    const onKey = (e) => {
      const key = e.key;
      if (key !== "Delete" && key !== "Backspace") return;

      const target = e.target;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "SELECT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (isTyping) return;

      if (selectedEdgeId) {
        e.preventDefault();
        deleteEdge(selectedEdgeId);
        return;
      }

      if (selectedNodeId) {
        e.preventDefault();
        deleteNode(selectedNodeId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedEdgeId, selectedNodeId, activeId, activeChain?.locked]);

  const setChainField = (key, value) => {
    const allowLocked = key === "muted" || key === "locked";
    updateActiveChain((c) => ({ ...c, [key]: value }), { allowLocked });
  };

  useEffect(() => {
    const onEsc = (e) => {
      if (e.key === "Escape") {
        setMenu(null);
        setIoMenu(null);
        setPlacing(null);
      }
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, []);

  const setGlobalA4 = (value) => {
    const a4 = Number(value);
    if (!Number.isFinite(a4)) return;
    if (synth?.setA4freq) synth.setA4freq(a4);
    else if (synth) synth.a4_freq = a4;
    commitState((prev) => ({ ...prev, global: { ...(prev.global || {}), a4 } }));
  };

  const setGlobalMaster = (value) => {
    const masterVol = Number(value);
    if (!Number.isFinite(masterVol)) return;
    if (synth?.setMasterVol) synth.setMasterVol(masterVol);
    else if (synth) synth.masterVol = masterVol;
    commitState((prev) => ({ ...prev, global: { ...(prev.global || {}), masterVol } }));
  };

  const fit = () => {
    setViewport(fitViewport(activeChain));
  };

  const downloadJson = (filename, data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };

  const exportAll = () => downloadJson("routing-composer-graph.json", state);

  const exportActiveChain = () => {
    if (!activeChain) return;
    downloadJson(`${activeChain.name || "chain"}.chain.json`, {
      version: 2,
      chain: activeChain,
      linearChain: graphChainToLinearChain(activeChain),
    });
  };

  const openImportPicker = (mode) => {
    importModeRef.current = mode;
    setIoMenu(null);
    fileInputRef.current?.click();
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      const mode = importModeRef.current;
      if (mode === "all") {
        const next = normalizeGraphState(json);
        if (!next) throw new Error("Invalid routing JSON");
        commitState(next);
        setActiveId(next.chains[0]?.id);
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        return;
      }

      if (mode === "chain" && activeChain?.locked) {
        throw new Error("Current chain is locked");
      }

      const rawChain = json?.chain ?? json;
      const imported = Array.isArray(rawChain)
        ? linearChainToGraphChain(rawChain, { name: activeChain?.name || "Imported Chain" })
        : normalizeGraphChain(rawChain, 0);
      if (!imported) throw new Error("Invalid chain JSON");
      const replacement = { ...imported, id: activeChain.id };
      commitState((prev) => ({
        ...prev,
        chains: prev.chains.map((c) => c.id === activeChain.id ? replacement : c),
      }));
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
    } catch (e) {
      console.warn("[RCG] import failed", e);
      alert(`Import failed: ${e.message || e}`);
    }
  };

  const beginPlaceModule = (kind) => {
    setPlacing({ kind });
    setMenu(null);
    setIoMenu(null);
  };

  const openIndependentPopout = () => {
    const w = window.open("", "routing-composer-graph-popout", "width=1440,height=820");
    if (!w) return;
    w.document.open();
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>Routing Composer Graph</title><style>html,body,#rcg-popout-root{margin:0;width:100%;height:100%;background:#070a11;overflow:hidden}</style></head><body><div id="rcg-popout-root"></div></body></html>`);
    w.document.close();
    const mount = w.document.getElementById("rcg-popout-root");
    try {
      if (popoutRootRef.current?.unmount) popoutRootRef.current.unmount();
      if (ReactDOM.createRoot) {
        const root = ReactDOM.createRoot(mount);
        popoutRootRef.current = root;
        root.render(<GraphComposer synth={null} initialState={state} embedded popoutWindow />);
      } else {
        ReactDOM.render(<GraphComposer synth={null} initialState={state} embedded popoutWindow />, mount);
        popoutRootRef.current = { unmount: () => ReactDOM.unmountComponentAtNode(mount) };
      }
      w.addEventListener("beforeunload", () => {
        try { popoutRootRef.current?.unmount?.(); } catch {}
        popoutRootRef.current = null;
      });
    } catch (e) {
      console.warn("[RCG] popout render failed", e);
    }
  };

  const root = (
    <div className={`rcg-window ${open ? "is-open" : ""} ${isRemoteView ? "is-pop" : ""} ${embedded ? "is-embedded" : ""}`}>
      <style>{graphCss}</style>
      <div className="rcg-top">
        <div className="rcg-title"><span className="rcg-logo" /> Routing Composer <span className="rcg-badge">Graph</span></div>
        <div className="rcg-spacer" />
        <label className="rcg-global">A4 <input type="range" min="420" max="460" step="0.1" value={state.global?.a4 ?? synth?.a4_freq ?? 440} onChange={(e) => setGlobalA4(e.target.value)} /> <span>{Number(state.global?.a4 ?? synth?.a4_freq ?? 440).toFixed(0)}Hz</span></label>
        <label className="rcg-global">Master <input type="range" min="0" max="1" step="0.01" value={state.global?.masterVol ?? synth?.masterVol ?? 0.3} onChange={(e) => setGlobalMaster(e.target.value)} /> <span>{Number(state.global?.masterVol ?? synth?.masterVol ?? 0.3).toFixed(2)}</span></label>
        <button className="rcg-btn" onClick={(e) => setIoMenu(ioMenu?.type === "import" ? null : { type: "import", x: e.clientX - 170, y: e.clientY + 18 })}>Import</button>
        <button className="rcg-btn" onClick={(e) => setIoMenu(ioMenu?.type === "export" ? null : { type: "export", x: e.clientX - 170, y: e.clientY + 18 })}>Export</button>
        {!isRemoteView && <button className="rcg-iconbtn" onClick={() => openIndependentPopout()}>↗</button>}
        {!embedded && !isPop && <button className="rcg-iconbtn" onClick={() => setOpen(false)}>×</button>}
      </div>

      <ChainTabs
        chains={state.chains}
        activeId={activeChain?.id}
        onSelect={(id) => { setActiveId(id); setSelectedNodeId(null); setSelectedEdgeId(null); }}
        onAdd={addChain}
        onToggleMute={(id) => commitState((prev) => ({ ...prev, chains: prev.chains.map((c) => c.id === id ? { ...c, muted: !c.muted } : c) }))}
        onToggleLock={(id) => commitState((prev) => ({ ...prev, chains: prev.chains.map((c) => c.id === id ? { ...c, locked: !c.locked } : c) }))}
        onDelete={deleteChain}
      />

      <div className="rcg-main">
        <div className="rcg-left">
          <div className="rcg-chainhead">
            <input className="rcg-chain-title" value={activeChain?.name || ""} onChange={(e) => setChainField("name", e.target.value)} />
            <button className="rcg-iconbtn" onClick={() => setChainField("muted", !activeChain.muted)}>{activeChain?.muted ? "🔇" : "🔊"}</button>
            <button className="rcg-iconbtn" onClick={() => setChainField("locked", !activeChain.locked)}>{activeChain?.locked ? "🔒" : "🔓"}</button>
            <label className="rcg-small">ch <select value={String(activeChain?.ch ?? "all")} onChange={(e) => setChainField("ch", e.target.value)}><option value="all">all</option>{Array.from({ length: 16 }, (_, i) => <option key={i} value={i}>{i}</option>)}</select></label>
            <label className="rcg-small">program <select value={String(activeChain?.program ?? "all")} onChange={(e) => setChainField("program", e.target.value)}><option value="all">all</option>{Array.from({ length: 128 }, (_, i) => <option key={i} value={i}>{i}</option>)}</select></label>
            <label className="rcg-small rcg-chain-gain">gain <input type="range" min="0" max="2" step="0.01" value={Number(activeChain?.gain ?? 1)} onChange={(e) => setChainField("gain", Number(e.target.value))} /><input className="rcg-chain-gain-num" type="number" min="0" max="2" step="0.01" value={Number(activeChain?.gain ?? 1)} onChange={(e) => setChainField("gain", Number(e.target.value))} /></label>
            <GraphToolbar
              zoom={viewport.zoom}
              onFit={fit}
              onZoomIn={() => setViewport({ ...viewport, zoom: Math.min(1.8, viewport.zoom * 1.1) })}
              onZoomOut={() => setViewport({ ...viewport, zoom: Math.max(0.35, viewport.zoom / 1.1) })}
              locked={!!activeChain?.locked}
              onAddModule={(e) => {
                if (activeChain?.locked) return;
                setMenu({ x: e.clientX - 180, y: e.clientY + 14, point: null, type: "moduleButton" });
              }}
            />
          </div>
          <GraphCanvas
            chain={activeChain}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            viewport={viewport}
            placing={activeChain?.locked ? null : placing}
            locked={!!activeChain?.locked}
            onViewport={setViewport}
            onGraph={updateGraph}
            onSelectNode={(id) => { setSelectedNodeId(id); if (id) setSelectedEdgeId(null); }}
            onSelectEdge={(id) => { setSelectedEdgeId(id); if (id) setSelectedNodeId(null); }}
            onContextMenu={(e, ctx) => {
              setIoMenu(null);
              if (activeChain?.locked) return;
              if (ctx.type === "edge") setMenu({ x: e.clientX, y: e.clientY, type: "edge", edge: ctx.edge });
              else setMenu({ x: e.clientX, y: e.clientY, type: "module", point: ctx.point });
            }}
            onNodeContextMenu={(e, node) => {
              setIoMenu(null);
              if (activeChain?.locked) return;
              setSelectedNodeId(node.id);
              setSelectedEdgeId(null);
              setMenu({ x: e.clientX, y: e.clientY, type: "node", node });
            }}
            onCanvasPointerDown={() => { if (menu) setMenu(null); if (ioMenu) setIoMenu(null); }}
            onPlaceModule={(kind, point) => { addModuleAt(kind, point); setPlacing(null); }}
            onCancelPlacing={() => setPlacing(null)}
          />
        </div>
        <GraphInspector
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          onParam={patchNodeParam}
          onNodePatch={patchNode}
          onDeleteNode={deleteNode}
          onDeleteEdge={deleteEdge}
        />
      </div>

      {menu && (
        <div className="rcg-menu" style={{ left: menu.x, top: menu.y }} onMouseLeave={() => {}}>
          {menu.type === "edge" ? (
            <button onClick={() => { deleteEdge(edgeId(menu.edge)); setMenu(null); }}>Delete connection</button>
          ) : menu.type === "node" ? (
            <>
              <div className="rcg-menu-muted">Module</div>
              <button onClick={() => { deleteNode(menu.node.id); setMenu(null); }}>Delete module</button>
            </>
          ) : (
            <>
              <div className="rcg-menu-muted">Add module</div>
              {MODULES.map((m) => <button key={m} onClick={() => { menu.type === "moduleButton" ? beginPlaceModule(m) : addModuleAt(m, menu.point || { x: 220, y: 220 }); setMenu(null); }}>{m}</button>)}
            </>
          )}
        </div>
      )}

      {ioMenu && (
        <div className="rcg-menu rcg-io-menu" style={{ left: ioMenu.x, top: ioMenu.y }}>
          {ioMenu.type === "import" ? (
            <>
              <div className="rcg-menu-muted">Import JSON</div>
              <button onClick={() => openImportPicker("all")}>Import all chains</button>
              <button onClick={() => openImportPicker("chain")}>Import current chain</button>
            </>
          ) : (
            <>
              <div className="rcg-menu-muted">Export JSON</div>
              <button onClick={() => { exportAll(); setIoMenu(null); }}>Export all chains</button>
              <button onClick={() => { exportActiveChain(); setIoMenu(null); }}>Export current chain</button>
            </>
          )}
        </div>
      )}

      <input ref={fileInputRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={handleImportFile} />
    </div>
  );

  if (!open && !embedded && !isPop) {
    return <><style>{graphCss}</style><button className="rcg-launcher" onClick={() => setOpen(true)}><span className="rcg-logo" /> Routing Composer</button></>;
  }

  return root;
}

const graphCss = `
.rcg-launcher{position:fixed;left:14px;top:14px;z-index:9999;display:flex;gap:10px;align-items:center;padding:10px 14px;border-radius:999px;border:1px solid #3b455c;background:#111827d9;color:#eaf0ff;font-weight:800;box-shadow:0 14px 42px #0009;cursor:pointer}.rcg-logo{width:28px;height:28px;border-radius:10px;background:linear-gradient(135deg,#63dcff,#b482ff);display:inline-block}.rcg-window{position:fixed;left:21px;top:21px;width:min(1180px,calc(100vw - 42px));height:min(660px,calc(100vh - 42px));border:1px solid #3a455c;border-radius:22px;background:linear-gradient(180deg,#101622f2,#090d16f2);box-shadow:0 24px 80px #000c;overflow:hidden;display:flex;flex-direction:column;z-index:9998;color:#eaf0ff;font-family:Inter,Segoe UI,Arial,sans-serif}.rcg-window.is-embedded{position:relative;left:auto;top:auto;width:100%;height:100%;min-height:560px;border-radius:14px}.rcg-window.is-pop{position:fixed;inset:0;width:100vw;height:100vh;border-radius:0;border:0}.rcg-top{height:58px;display:flex;align-items:center;gap:12px;padding:0 16px;border-bottom:1px solid #2d374c;background:#111724e8}.rcg-window.is-pop .rcg-top{height:64px}.rcg-title{font-size:21px;font-weight:900;display:flex;align-items:center;gap:10px}.rcg-badge{font-size:12px;color:#cbd6eb;border:1px solid #3a4354;border-radius:10px;padding:2px 7px;background:#ffffff13}.rcg-spacer{flex:1}.rcg-global{display:flex;align-items:center;gap:8px;color:#cbd6eb;font-size:14px;white-space:nowrap}.rcg-global input{width:82px}.rcg-btn,.rcg-iconbtn{border:1px solid #3a4459;background:#ffffff11;color:#eaf0ff;cursor:pointer}.rcg-btn{padding:8px 11px;border-radius:12px;font-size:14px}.rcg-iconbtn{width:36px;height:36px;border-radius:12px;display:grid;place-items:center;font-size:17px}.rcg-btn:hover,.rcg-iconbtn:hover{background:#ffffff20}.rcg-btn:disabled,.rcg-iconbtn:disabled{opacity:.45;cursor:not-allowed}.rcg-chainbar{height:62px;display:flex;align-items:center;gap:10px;padding:9px 16px;border-bottom:1px solid #2d374c;background:#0f1420cc;overflow-x:auto}.rcg-chain{min-width:178px;height:44px;display:flex;align-items:center;gap:10px;padding:0 11px;border-radius:14px;border:1px solid #313b4f;background:#ffffff0d;cursor:pointer;color:#dde7f9;font-weight:850;font-size:17px}.rcg-chain.is-active{border-color:#55d6ff;box-shadow:0 0 0 1px #55d6ff66 inset;background:#152437}.rcg-folder{width:28px;height:21px;border-radius:6px;background:linear-gradient(180deg,#486ac0,#25365f);position:relative}.rcg-folder:before{content:"";position:absolute;left:5px;top:-6px;width:14px;height:8px;border-radius:6px 6px 0 0;background:#5578cf}.rcg-chain-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rcg-chain-icons{margin-left:auto;font-size:14px;display:flex;gap:8px}.rcg-add-chain{min-width:92px;justify-content:center;font-weight:500}.rcg-main{flex:1;display:grid;grid-template-columns:minmax(500px,1fr) 300px;min-height:0}.rcg-window.is-pop .rcg-main{grid-template-columns:minmax(620px,1fr) 340px}.rcg-left{display:flex;flex-direction:column;min-width:0}.rcg-chainhead{height:54px;display:flex;align-items:center;gap:8px;padding:6px 16px;border-bottom:1px solid #2d374c;background:#111724cc}.rcg-chain-title{width:86px;min-width:74px;background:transparent;color:#eaf0ff;border:0;font-size:18px;font-weight:900;outline:none}.rcg-small{display:flex;align-items:center;gap:5px;color:#aebbd1;font-size:13px;white-space:nowrap}.rcg-small select,.rcg-small input{background:#0d111b;border:1px solid #343e53;border-radius:10px;color:#e7eefc;padding:7px 9px;font-size:13px;min-width:52px;max-width:72px}.rcg-chain-gain{min-width:180px}.rcg-chain-gain input[type=range]{width:90px;min-width:90px;max-width:90px;padding:0}.rcg-chain-gain-num{width:54px!important;min-width:54px!important;max-width:54px!important}.rcg-toolbar{margin-left:auto;display:flex;align-items:center;gap:7px}.rcg-zoom{font-size:13px;color:#aebbd1;width:38px;text-align:center}.rcg-workspace{position:relative;flex:1;min-height:0;background:#070a11;overflow:hidden;cursor:grab;user-select:none}.rcg-workspace.is-panning{cursor:grabbing}.rcg-grid{position:absolute;inset:-200%;background-image:linear-gradient(#25334f55 1px,transparent 1px),linear-gradient(90deg,#25334f55 1px,transparent 1px);background-size:48px 48px;opacity:.55;transform-origin:0 0;pointer-events:none}.rcg-world{position:absolute;left:0;top:0;transform-origin:0 0}.rcg-edges{position:absolute;left:0;top:0;overflow:visible}.rcg-edge-hit{fill:none;stroke:transparent;stroke-width:26;pointer-events:stroke;cursor:pointer}.rcg-edge{fill:none;stroke:#59d8ff;stroke-width:4;stroke-linecap:round;filter:drop-shadow(0 0 5px #3ccfff99);pointer-events:none;stroke-dasharray:18 12;animation:rcg-flow 1.1s linear infinite}.rcg-edge.is-selected{stroke:#fff;stroke-width:5;stroke-dasharray:0;animation:none}.rcg-ghost{position:absolute;width:132px;height:66px;border:2px dashed #70dfff;border-radius:12px;background:#70dfff18;pointer-events:none;display:flex;align-items:center;padding:10px;font-weight:900;color:#dff8ff;z-index:4}.rcg-preview{fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-dasharray:8 7;filter:drop-shadow(0 0 5px #fff8);pointer-events:none}@keyframes rcg-flow{to{stroke-dashoffset:-30}}.rcg-node{position:absolute;width:132px;height:66px;border:2px solid #5b6679;border-radius:12px;background:linear-gradient(180deg,#22314c 0%,#172235 48%,#0c1320 100%);box-shadow:0 12px 28px #000b,inset 0 1px 0 #ffffff16,inset 0 0 28px #62d6ff10;cursor:move;padding:10px}.rcg-node.is-selected{box-shadow:0 0 0 2px #fff7,0 0 20px #65d9ff88}.rcg-node-ks_source{border-color:#ff67dc;background:linear-gradient(180deg,#2a2541,#171326 80%)}.rcg-node-filter{border-color:#ffd45e;background:linear-gradient(180deg,#2a2635,#151724 80%)}.rcg-node-delay{border-color:#a979ff;background:linear-gradient(180deg,#252346,#131427 80%)}.rcg-node-gain{border-color:#72e18a;background:linear-gradient(180deg,#1c3329,#111e1b 80%)}.rcg-node-output{border-color:#37cfff;background:linear-gradient(180deg,#18314a,#0d1724 80%)}.rcg-node-analyzer{border-color:#98a8c6;background:linear-gradient(180deg,#252e44,#121827 80%)}.rcg-node-reverb{border-color:#55c3ff;background:linear-gradient(180deg,#1b3046,#0f1724 80%)}.rcg-node-source{border-color:#ff9f64;background:linear-gradient(180deg,#382a22,#19130f 80%)}.rcg-node-title{font-weight:900;font-size:14px;display:flex;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rcg-ports{position:absolute;left:9px;right:9px;bottom:7px;display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#d2ddf0}.rcg-port-wrap{display:flex;gap:6px;align-items:center}.rcg-port{width:12px;height:12px;border-radius:50%;background:#70dfff;box-shadow:0 0 10px #6bdfff;display:inline-block;cursor:crosshair}.rcg-hint{position:absolute;left:14px;bottom:12px;color:#9ba8bd;background:#09101bcc;border:1px solid #263249;border-radius:999px;padding:7px 11px;font-size:12px;pointer-events:none}.rcg-menu{position:fixed;min-width:205px;background:#131927;border:1px solid #3a455c;border-radius:14px;box-shadow:0 18px 50px #000b;z-index:10000;padding:8px}.rcg-menu button{display:block;width:100%;text-align:left;background:transparent;border:0;color:#eaf0ff;padding:11px 12px;border-radius:10px;font-size:15px;cursor:pointer}.rcg-menu button:hover{background:#ffffff14}.rcg-menu-muted{color:#9ba8bd;font-size:13px;padding:8px 12px}.rcg-inspector{border-left:1px solid #2d374c;background:#0c111bcc;min-width:0;display:flex;flex-direction:column}.rcg-insp-title{height:54px;border-bottom:1px solid #2d374c;display:flex;align-items:center;padding:0 16px;font-size:18px;font-weight:950}.rcg-insp-body{padding:14px;overflow-y:auto;flex:1;min-height:0}.rcg-sub{color:#8f9bb0;font-size:14px;margin-top:-6px;margin-bottom:18px}.rcg-param{margin:12px 0}.rcg-param label{display:flex;justify-content:space-between;color:#c8d2e5;margin-bottom:8px}.rcg-param input[type=text],.rcg-param select{width:100%;background:#1a202d;border:1px solid #394257;border-radius:10px;color:#eaf0ff;padding:9px;font-size:13px}.rcg-param input[type=range]{width:100%}.rcg-param-row{display:flex;gap:8px;align-items:center}.rcg-param-row input[type=range]{flex:1}.rcg-num{width:62px!important;background:#111827!important}.rcg-danger{width:100%;margin-top:18px;background:#31151f!important;border-color:#743140!important;color:#ffd3d8!important}.rcg-empty{height:100%;display:grid;place-items:center;color:#8f9bb0;font-size:18px;text-align:center}.rcg-help{font-size:12px;color:#93a0b8;line-height:1.7;margin-top:12px}.rcg-check{display:flex;gap:8px;align-items:center;color:#c8d2e5;margin-top:16px}@media (max-height:720px){.rcg-window:not(.is-pop){height:calc(100vh - 24px);top:12px}.rcg-window:not(.is-pop) .rcg-chainbar{height:56px}.rcg-window:not(.is-pop) .rcg-top{height:54px}}
`;
