// routing-composer/src/components/graph/PopoutBridge.js
// -------------------------------------------------------------
// Small BroadcastChannel helper for Mini <-> Pop-out editor sync.
// Main app / mini is still the audio source of truth.
// -------------------------------------------------------------

export function createPopoutBridge(channelName = "routing-composer-graph") {
  const supported = typeof BroadcastChannel !== "undefined";
  const channel = supported ? new BroadcastChannel(channelName) : null;
  const listeners = new Set();

  if (channel) {
    channel.onmessage = (event) => {
      const msg = event.data || {};
      for (const fn of listeners) fn(msg);
    };
  }

  return {
    supported,
    post(msg) {
      try {
        channel?.postMessage(msg);
      } catch (e) {
        console.warn("[RCG] BroadcastChannel post failed", e);
      }
    },
    on(fn) {
      if (typeof fn !== "function") return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    close() {
      try { channel?.close(); } catch {}
      listeners.clear();
    },
  };
}

export function openGraphPopout() {
  const url = new URL(window.location.href);
  url.searchParams.set("rc_popout", "1");
  // keep relative to the current deployment path; never write a local C:/ path.
  return window.open(url.toString(), "routing-composer-graph-popout", "width=1440,height=820");
}

export function isGraphPopout() {
  try {
    return new URL(window.location.href).searchParams.get("rc_popout") === "1";
  } catch {
    return false;
  }
}
