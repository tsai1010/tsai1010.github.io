import React from "react";

export default function ChainTabs({ chains, activeId, onSelect, onAdd, onToggleMute, onToggleLock, onDelete }) {
  return (
    <div className="rcg-chainbar">
      {chains.map((c) => (
        <button
          key={c.id}
          className={`rcg-chain ${c.id === activeId ? "is-active" : ""}`}
          onClick={() => onSelect(c.id)}
          title={c.name}
        >
          <span className="rcg-folder" />
          <span className="rcg-chain-name">{c.name}</span>
          <span className="rcg-chain-icons">
            <span
              onClick={(e) => {
                e.stopPropagation();
                onToggleMute?.(c.id);
              }}
              title="mute"
            >{c.muted ? "🔇" : "🔊"}</span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                onToggleLock?.(c.id);
              }}
              title="lock"
            >{c.locked ? "🔒" : "🔓"}</span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                if (!c.locked && chains.length > 1) onDelete?.(c.id);
              }}
              title={c.locked ? "locked chain cannot be deleted" : "delete chain"}
              style={{ opacity: c.locked || chains.length <= 1 ? 0.35 : 0.9 }}
            >×</span>
          </span>
        </button>
      ))}
      <button className="rcg-chain rcg-add-chain" onClick={onAdd}>+ Chain</button>
    </div>
  );
}
