// routing-composer/src/index.jsx
// -------------------------------------------------------------
// Entry point for Routing Composer GUI
// - Exports AudioPatchbay (for React apps)
// - Defines window.RoutingComposer.mount() global API (for browser use)
// -------------------------------------------------------------

import React from "react";
import ReactDOM from "react-dom";
import AudioPatchbay from "./components/AudioPatchbay.jsx";

// ✅ 給 React 專案直接 import 用
export default AudioPatchbay;

// ✅ 給瀏覽器 (window) 用的自動掛載版本
(function initGlobal() {
  if (typeof window === "undefined") return;

  const API = {
    /**
     * Mounts Routing Composer GUI into the current page.
     * @param {object} opts
     * @param {MidiSynth} opts.synth - Your MidiSynth instance.
     * @param {string|HTMLElement} [opts.button] - CSS selector or DOM node for button mount.
     * @param {'auto'|boolean} [opts.tailwind='auto'] - Whether to auto inject Tailwind.
     * @returns {{ host: HTMLElement }} The container div.
     */
    mount(opts = {}) {
      const { synth, button, tailwind = "auto" } = opts;

      // Resolve button target
      let buttonTarget = null;
      if (button) {
        if (typeof button === "string") {
          buttonTarget = document.querySelector(button);
        } else if (button instanceof HTMLElement) {
          buttonTarget = button;
        }
      }

      // Create container
      const host = document.createElement("div");
      document.body.appendChild(host);

      // Render React root
      if (ReactDOM.createRoot) {
        const root = ReactDOM.createRoot(host);
        root.render(
          <AudioPatchbay
            synth={synth}
            buttonTarget={buttonTarget}
            autoTailwind={tailwind === "auto"}
          />
        );
      } else {
        // legacy fallback
        ReactDOM.render(
          <AudioPatchbay
            synth={synth}
            buttonTarget={buttonTarget}
            autoTailwind={tailwind === "auto"}
          />,
          host
        );
      }

      console.log("[RoutingComposer] mounted GUI");
      return { host };
    },
  };

  // 掛到全域 window
  window.RoutingComposer = API;
})();
