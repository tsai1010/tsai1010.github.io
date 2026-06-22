import React from "react";

export default function GraphToolbar({ onAddModule, onFit, zoom, onZoomIn, onZoomOut, locked = false }) {
  return (
    <div className="rcg-toolbar">
      <button className="rcg-btn" disabled={locked} onClick={(e) => onAddModule?.(e)}>+ Module</button>
      <button className="rcg-btn" onClick={onFit}>Fit</button>
      <button className="rcg-iconbtn" onClick={onZoomOut}>−</button>
      <span className="rcg-zoom">{Math.round((zoom || 1) * 100)}%</span>
      <button className="rcg-iconbtn" onClick={onZoomIn}>+</button>
    </div>
  );
}
