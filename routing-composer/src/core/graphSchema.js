// routing-composer/src/core/graphSchema.js
// -------------------------------------------------------------
// Serializable Routing Composer v2 graph schema documentation.
// -------------------------------------------------------------

/**
 * @typedef {Object} GraphNode
 * @property {string} id
 * @property {string} kind          ks_source | source | filter | delay | gain | analyzer | convolver_ir | reverb | output
 * @property {number} x             Editor position, exported with preset
 * @property {number} y             Editor position, exported with preset
 * @property {boolean=} enabled
 * @property {Object=} params
 */

/**
 * @typedef {Object} GraphEdge
 * @property {string} id
 * @property {string} from
 * @property {string=} fromPort     default: out
 * @property {string} to
 * @property {string=} toPort       default: in
 */

/**
 * @typedef {Object} GraphChain
 * @property {string} id
 * @property {string} name
 * @property {boolean=} muted
 * @property {boolean=} locked
 * @property {string|number=} ch
 * @property {string|number=} program
 * @property {number=} gain
 * @property {{nodes:GraphNode[], edges:GraphEdge[]}} graph
 */

/**
 * @typedef {Object} RoutingGraphState
 * @property {2} version
 * @property {GraphChain[]} chains
 * @property {{a4?:number, masterVol?:number}=} global
 * @property {Object=} ui
 */

export {};
