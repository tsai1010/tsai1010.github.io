// src/core/routingIO.js
// -------------------------------------------------------------
// Routing Composer - JSON I/O helpers
// - normalize full routing state
// - normalize single-chain JSON
// -------------------------------------------------------------

function isModule(obj) {
  return obj && typeof obj === "object" && typeof obj.kind === "string";
}

function normalizeChain(chain, opts = {}) {
  const idPrefix = opts.idPrefix || "";

  if (!Array.isArray(chain)) return null;

  return chain
    .filter(isModule)
    .map((m) => {
      const baseId = m.id || `${m.kind}_${Math.random().toString(36).slice(2, 9)}`;
      return {
        id: idPrefix ? `${idPrefix}${baseId}` : baseId,
        kind: m.kind,
        enabled: m.enabled !== false,
        params: typeof m.params === "object" && m.params ? { ...m.params } : {},
      };
    });
}


/**
 * Normalize full routing JSON
 * Accepts:
 *  - { chains, chainMeta?, mutes?, version? }
 *  - or directly Array<Array<Module>>
 */
export function normalizeRoutingState(json) {
  if (!json) return null;

  // case: direct chains array
  if (Array.isArray(json) && Array.isArray(json[0])) {
    const chains = json
      .map((chain, idx) => normalizeChain(chain, { idPrefix: `c${idx}_` }))
      .filter(Boolean);

    return {
      version: 1,
      chains,
      chainMeta: chains.map(() => ({})),
      mutes: chains.map(() => false),
    };
  }

  // case: object form
  const chainsRaw = json.chains;
  if (!Array.isArray(chainsRaw)) return null;

  const chains = chainsRaw
    .map((chain, idx) => normalizeChain(chain, { idPrefix: `c${idx}_` }))
    .filter(Boolean);

  const chainMeta = Array.isArray(json.chainMeta)
    ? json.chainMeta.slice(0, chains.length)
    : [];

  while (chainMeta.length < chains.length) chainMeta.push({});

  const mutes = Array.isArray(json.mutes)
    ? json.mutes.slice(0, chains.length)
    : [];

  while (mutes.length < chains.length) mutes.push(false);

  return {
    version: Number(json.version) || 1,
    chains,
    chainMeta,
    mutes,
  };
}


/**
 * Normalize single-chain JSON
 * Accepts:
 *  - { chain, meta?, mute? }
 *  - or directly Array<Module>
 */
export function normalizeSingleChain(json, opts = {}) {
  const idPrefix = opts.idPrefix || "";

  const normalizeMods = (arr) =>
    (Array.isArray(arr) ? arr : []).map((m, i) => {
      const baseId = m.id || `${m.kind}_${i}_${Math.random().toString(36).slice(2, 8)}`;
      return {
        ...m,
        id: idPrefix ? `${idPrefix}${baseId}` : baseId,
        enabled: m.enabled !== false,
        params: m.params || {},
      };
    });

  // json 可以是 array 或 {chain, meta, mute}
  if (Array.isArray(json)) {
    return { chain: normalizeMods(json), meta: {}, mute: false };
  }
  if (json && Array.isArray(json.chain)) {
    return {
      chain: normalizeMods(json.chain),
      meta: json.meta || {},
      mute: !!json.mute,
    };
  }
  return null;
}

