// ============================================================
// Graph Library — Topology graph construction & traversal
// ============================================================

import type {
  TopologyGraph,
  TopologyNode,
  TopologyEdge,
  SmartscapeNodeType,
  NodeMetrics,
  NodeLimits,
} from "../types";

// ---- Graph Construction ----

const DEFAULT_METRICS: NodeMetrics = {
  timeseries: {},
};

const DEFAULT_LIMITS: NodeLimits = {
  maxCpuPct: 100,
  maxMemoryPct: 100,
  maxDiskPct: 100,
  canScaleHorizontally: false,
  canScaleVertically: false,
};

/** Create an empty topology graph */
export function createGraph(): TopologyGraph {
  return {
    nodes: new Map(),
    edges: [],
    adjacency: new Map(),
    reverseAdjacency: new Map(),
  };
}

/** Add a node to the graph */
export function addNode(
  graph: TopologyGraph,
  id: string,
  name: string,
  type: SmartscapeNodeType,
  metadata: Record<string, unknown> = {}
): TopologyNode {
  const node: TopologyNode = {
    id,
    name,
    type,
    metrics: { ...DEFAULT_METRICS },
    limits: { ...DEFAULT_LIMITS },
    metadata,
  };
  graph.nodes.set(id, node);
  if (!graph.adjacency.has(id)) graph.adjacency.set(id, []);
  if (!graph.reverseAdjacency.has(id)) graph.reverseAdjacency.set(id, []);
  return node;
}

/** Add an edge to the graph */
export function addEdge(
  graph: TopologyGraph,
  edge: Omit<TopologyEdge, "id">
): TopologyEdge {
  const fullEdge: TopologyEdge = {
    ...edge,
    id: `${edge.sourceId}--${edge.edgeType}--${edge.targetId}`,
  };
  graph.edges.push(fullEdge);

  const fwd = graph.adjacency.get(edge.sourceId) ?? [];
  fwd.push(fullEdge);
  graph.adjacency.set(edge.sourceId, fwd);

  const rev = graph.reverseAdjacency.get(edge.targetId) ?? [];
  rev.push(fullEdge);
  graph.reverseAdjacency.set(edge.targetId, rev);

  return fullEdge;
}

// ---- Graph Traversal ----

/** BFS from entry points, returning nodes in order of discovery */
export function bfsForward(
  graph: TopologyGraph,
  entryPointIds: string[]
): string[] {
  const visited = new Set<string>();
  const queue: string[] = [];
  const result: string[] = [];

  for (const id of entryPointIds) {
    if (graph.nodes.has(id) && !visited.has(id)) {
      visited.add(id);
      queue.push(id);
      result.push(id);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const outEdges = graph.adjacency.get(current) ?? [];

    for (const edge of outEdges) {
      if (!visited.has(edge.targetId)) {
        visited.add(edge.targetId);
        queue.push(edge.targetId);
        result.push(edge.targetId);
      }
    }
  }

  return result;
}

/** BFS backward (upstream) from a node */
export function bfsBackward(
  graph: TopologyGraph,
  startId: string
): string[] {
  const visited = new Set<string>();
  const queue: string[] = [];
  const result: string[] = [];

  if (graph.nodes.has(startId)) {
    visited.add(startId);
    queue.push(startId);
    result.push(startId);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const inEdges = graph.reverseAdjacency.get(current) ?? [];

    for (const edge of inEdges) {
      if (!visited.has(edge.sourceId)) {
        visited.add(edge.sourceId);
        queue.push(edge.sourceId);
        result.push(edge.sourceId);
      }
    }
  }

  return result;
}

// ---- Multiplier Propagation ----

export interface PropagationResult {
  /** nodeId → effective multiplier that reached this node */
  multipliers: Map<string, number>;
  /** nodeId → path of node IDs from entry point to this node */
  paths: Map<string, string[]>;
  /** Order of nodes visited */
  visitOrder: string[];
}

/**
 * Propagate a multiplier through the graph from entry points.
 * At each hop, the incoming multiplier is multiplied by the edge's fan-out ratio.
 * If a node is reached by multiple paths, the maximum multiplier is used.
 *
 * dampening: factor applied per hop to prevent infinite growth in cycles (default 0.1)
 */
export function propagateMultiplier(
  graph: TopologyGraph,
  entryPointIds: string[],
  baseMultiplier: number,
  maxHops: number = 20,
  dampening: number = 0.1
): PropagationResult {
  const multipliers = new Map<string, number>();
  const paths = new Map<string, string[]>();
  const visitOrder: string[] = [];
  const visited = new Set<string>();

  // Queue: [nodeId, currentMultiplier, path, hopCount]
  const queue: Array<[string, number, string[], number]> = [];

  for (const id of entryPointIds) {
    if (!graph.nodes.has(id)) continue;
    multipliers.set(id, baseMultiplier);
    paths.set(id, [id]);
    queue.push([id, baseMultiplier, [id], 0]);
  }

  while (queue.length > 0) {
    const [nodeId, currentMult, path, hops] = queue.shift()!;

    if (!visited.has(nodeId)) {
      visited.add(nodeId);
      visitOrder.push(nodeId);
    }

    if (hops >= maxHops) continue;

    const outEdges = graph.adjacency.get(nodeId) ?? [];

    for (const edge of outEdges) {
      const targetMult = currentMult * edge.fanOutRatio;

      // Cycle detection: if already visited, apply dampening
      const existingMult = multipliers.get(edge.targetId) ?? 0;
      if (visited.has(edge.targetId)) {
        // Apply dampened multiplier only if it's significantly larger
        const dampenedMult = targetMult * dampening;
        if (dampenedMult > existingMult) {
          multipliers.set(edge.targetId, dampenedMult);
        }
        continue;
      }

      // Take the maximum multiplier if reached via multiple paths
      if (targetMult > existingMult) {
        multipliers.set(edge.targetId, targetMult);
        paths.set(edge.targetId, [...path, edge.targetId]);
      }

      queue.push([edge.targetId, targetMult, [...path, edge.targetId], hops + 1]);
    }
  }

  return { multipliers, paths, visitOrder };
}

// ---- Utility ----

/** Get all downstream neighbors of a node */
export function getDownstream(graph: TopologyGraph, nodeId: string): TopologyNode[] {
  const edges = graph.adjacency.get(nodeId) ?? [];
  return edges
    .map((e) => graph.nodes.get(e.targetId))
    .filter((n): n is TopologyNode => n !== undefined);
}

/** Get all upstream neighbors of a node */
export function getUpstream(graph: TopologyGraph, nodeId: string): TopologyNode[] {
  const edges = graph.reverseAdjacency.get(nodeId) ?? [];
  return edges
    .map((e) => graph.nodes.get(e.sourceId))
    .filter((n): n is TopologyNode => n !== undefined);
}

/** Filter nodes by type */
export function nodesByType(
  graph: TopologyGraph,
  type: SmartscapeNodeType
): TopologyNode[] {
  const result: TopologyNode[] = [];
  for (const node of graph.nodes.values()) {
    if (node.type === type) result.push(node);
  }
  return result;
}

/** Get graph statistics for display */
export function graphStats(graph: TopologyGraph): {
  nodeCount: number;
  edgeCount: number;
  nodeTypeBreakdown: Record<string, number>;
  edgeTypeBreakdown: Record<string, number>;
} {
  const nodeTypeBreakdown: Record<string, number> = {};
  for (const node of graph.nodes.values()) {
    nodeTypeBreakdown[node.type] = (nodeTypeBreakdown[node.type] ?? 0) + 1;
  }

  const edgeTypeBreakdown: Record<string, number> = {};
  for (const edge of graph.edges) {
    edgeTypeBreakdown[edge.edgeType] = (edgeTypeBreakdown[edge.edgeType] ?? 0) + 1;
  }

  return {
    nodeCount: graph.nodes.size,
    edgeCount: graph.edges.length,
    nodeTypeBreakdown,
    edgeTypeBreakdown,
  };
}
