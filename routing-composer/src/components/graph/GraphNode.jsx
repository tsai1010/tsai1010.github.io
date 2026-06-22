import React from "react";

const LABELS = {
  ks_source: "KS",
  source: "Osc",
  filter: "Filter",
  delay: "Delay",
  gain: "Gain",
  analyzer: "Ana",
  convolver_ir: "IR",
  reverb: "Rev",
  output: "Out",
};

const ICONS = {
  ks_source: "🎸",
  source: "◉",
  filter: "▾",
  delay: "◴",
  gain: "◯",
  analyzer: "▣",
  convolver_ir: "▧",
  reverb: "◎",
  output: "▶",
};

export default function GraphNode({
  node,
  selected,
  onSelect,
  onPointerDown,
  onPortPointerDown,
  onPortPointerUp,
  onContextMenu,
}) {
  const label = LABELS[node.kind] || node.kind;
  const icon = ICONS[node.kind] || "□";
  return (
    <div
      className={`rcg-node rcg-node-${node.kind} ${selected ? "is-selected" : ""}`}
      data-node-id={node.id}
      data-node-kind={node.kind}
      style={{ left: node.x, top: node.y }}
      onPointerDown={(e) => onPointerDown?.(e, node.id)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(node.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect?.(node.id);
        onContextMenu?.(e, node);
      }}
    >
      <div className="rcg-node-title">
        <span>{icon}</span>
        <span>{label}</span>
      </div>
      <div className="rcg-ports">
        {node.kind !== "ks_source" && node.kind !== "source" ? (
          <span className="rcg-port-wrap">
            <span
              className="rcg-port rcg-in"
              data-node-id={node.id}
              data-port="in"
              onPointerUp={(e) => onPortPointerUp?.(e, node.id, "in")}
              title="input"
            />
            in
          </span>
        ) : <span />}
        <span className="rcg-port-wrap">
          out
          <span
            className="rcg-port rcg-out"
            data-node-id={node.id}
            data-port="out"
            onPointerDown={(e) => onPortPointerDown?.(e, node.id, "out")}
            title="output"
          />
        </span>
      </div>
    </div>
  );
}
