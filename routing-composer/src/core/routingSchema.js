/**
 * Routing Composer – External State Schema (serializable)
 *
 * This describes the JSON format used by:
 * - AudioPatchbay initialState / onChange
 * - import/export (full / single chain)
 * - future loadFromURL / controller API
 */

/**
 * @typedef {Object} ChainMeta
 * @property {string=} name      Display name for the chain
 * @property {boolean=} locked   If true, GUI editing is disabled for this chain
 */

/**
 * @typedef {Object} RoutingState
 * @property {Array<Array<Object>>} chains
 * @property {Array<ChainMeta>=} chainMeta
 * @property {Array<boolean>=} mutes
 */

// no runtime exports needed
export {};
