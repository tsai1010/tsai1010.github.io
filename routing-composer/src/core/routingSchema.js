/**
 * Routing Composer – External State Schema (serializable)
 *
 * v1 classic format (still supported):
 * {
 *   version: 1,
 *   chains: Array<Array<Module>>,
 *   chainMeta?: Array<{ name?: string, locked?: boolean }>,
 *   mutes?: Array<boolean>,
 *   global?: { a4?: number, masterVol?: number }
 * }
 *
 * v2 graph format (preferred):
 * {
 *   version: 2,
 *   chains: Array<GraphChain>,
 *   global?: { a4?: number, masterVol?: number },
 *   ui?: Object
 * }
 *
 * GraphChain:
 * {
 *   id: string,
 *   name: string,
 *   muted?: boolean,
 *   locked?: boolean,
 *   ch?: 'all' | number | string,
 *   program?: 'all' | number | string,
 *   gain?: number,
 *   graph: {
 *     nodes: Array<{
 *       id: string,
 *       kind: 'ks_source'|'source'|'filter'|'delay'|'gain'|'analyzer'|'convolver_ir'|'reverb'|'output',
 *       x: number,
 *       y: number,
 *       enabled?: boolean,
 *       params?: Object
 *     }>,
 *     edges: Array<{
 *       id: string,
 *       from: string,
 *       fromPort?: 'out',
 *       to: string,
 *       toPort?: 'in'
 *     }>
 *   }
 * }
 */

export {};
