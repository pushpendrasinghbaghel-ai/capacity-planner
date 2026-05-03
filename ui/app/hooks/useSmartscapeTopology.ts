// ============================================================
// useSmartscapeTopology — Build a TopologyGraph from DQL queries
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import type {
  TopologyGraph,
  SmartscapeNodeType,
  SmartscapeEdgeType,
} from "../types";
import { createGraph, addNode, addEdge } from "../lib/graph";

/** All node types available for filtering */
export const ALL_NODE_TYPES: SmartscapeNodeType[] = [
  "SERVICE",
  "HOST",
  "PROCESS",
  "FRONTEND",
  "K8S_CLUSTER",
  "K8S_NODE",
  "K8S_NAMESPACE",
  "K8S_POD",
  "K8S_DEPLOYMENT",
];

/** Edge types we care about for capacity analysis */
const EDGE_TYPES: SmartscapeEdgeType[] = [
  "calls",
  "runs_on",
  "belongs_to",
  "contains",
  "balanced_by",
  "is_part_of",
  "uses",
];

type TopologyStatus = "idle" | "loading" | "success" | "error";

export interface TopologyOptions {
  /** DQL timeframe clause e.g. "from: now()-7d, to: now()" */
  timeframeDql: string;
  /** Node types to fetch — pass subset to filter */
  nodeTypes: SmartscapeNodeType[];
  /** Max nodes to fetch (default 1000) */
  maxNodes?: number;
}

interface UseSmartscapeTopologyResult {
  graph: TopologyGraph;
  status: TopologyStatus;
  error: string | null;
  reload: () => void;
  nodeCount: number;
  edgeCount: number;
}

async function executeDql(query: string): Promise<Record<string, unknown>[]> {
  const response = await queryExecutionClient.queryExecute({
    body: {
      query,
      requestTimeoutMilliseconds: 30000,
      maxResultRecords: 5000,
    },
  });

  // Poll for results
  const state = response.state;
  if (state === "SUCCEEDED") {
    return (response.result?.records as Record<string, unknown>[]) ?? [];
  }

  // If not yet complete, poll request token
  if (response.requestToken) {
    let attempts = 0;
    while (attempts < 30) {
      await new Promise((r) => setTimeout(r, 1000));
      const pollResponse = await queryExecutionClient.queryPoll({
        requestToken: response.requestToken,
      });
      if (pollResponse.state === "SUCCEEDED") {
        return (pollResponse.result?.records as Record<string, unknown>[]) ?? [];
      }
      if (pollResponse.state === "FAILED" || pollResponse.state === "CANCELLED") {
        throw new Error(`Query ${pollResponse.state}: ${query.substring(0, 80)}`);
      }
      attempts++;
    }
  }

  return [];
}

/** Fetch all relevant nodes from Smartscape */
async function fetchNodes(
  nodeTypes: SmartscapeNodeType[],
  maxNodes: number
): Promise<
  Array<{ id: string; name: string; type: SmartscapeNodeType; metadata: Record<string, unknown> }>
> {
  const typeList = nodeTypes.map((t) => `"${t}"`).join(", ");
  const query = `smartscapeNodes ${typeList}
| fields sid = id, name, type, tags
| fieldsAdd id = toString(sid)
| fields id, name, type, tags
| limit ${maxNodes}`;

  const records = await executeDql(query);
  return records.map((r) => ({
    id: r.id as string,
    name: (r.name as string) ?? (r.id as string),
    type: r.type as SmartscapeNodeType,
    metadata: { tags: r.tags ?? {} },
  }));
}

/** Fetch all relevant edges from Smartscape */
async function fetchEdges(maxEdges: number): Promise<
  Array<{
    sourceId: string;
    targetId: string;
    sourceType: SmartscapeNodeType;
    targetType: SmartscapeNodeType;
    edgeType: SmartscapeEdgeType;
    edgeKind: "static" | "dynamic";
  }>
> {
  const edgeList = EDGE_TYPES.map((e) => `"${e}"`).join(", ");
  const query = `smartscapeEdges ${edgeList}
| fieldsAdd src = toString(source_id), tgt = toString(target_id)
| fields src, tgt, source_type, target_type, type, dt.system.edge_kind
| limit ${maxEdges}`;

  const records = await executeDql(query);
  return records.map((r) => ({
    sourceId: r.src as string,
    targetId: r.tgt as string,
    sourceType: r.source_type as SmartscapeNodeType,
    targetType: r.target_type as SmartscapeNodeType,
    edgeType: r.type as SmartscapeEdgeType,
    edgeKind: (r["dt.system.edge_kind"] as "static" | "dynamic") ?? "static",
  }));
}

/** Fetch service-to-service fan-out ratios from spans (non-critical, fire-and-forget) */
async function fetchFanOutRatios(timeframeDql: string): Promise<Map<string, number>> {
  // Use span.kind instead of request.is_root_span (which can be null for non-root spans)
  const query = `fetch spans, ${timeframeDql}
| filter span.kind == "client"
| summarize downstream_calls = count(), by: {dt.smartscape.service}
| lookup [
    fetch spans, ${timeframeDql}
    | filter span.kind == "server"
    | summarize server_calls = count(), by: {dt.smartscape.service}
  ], sourceField: dt.smartscape.service, lookupField: dt.smartscape.service
| fieldsAdd fan_out = toDouble(downstream_calls) / toDouble(lookup.server_calls)
| fields dt.smartscape.service, fan_out
| filter isNotNull(fan_out)`;

  try {
    const records = await executeDql(query);
    const ratios = new Map<string, number>();
    for (const r of records) {
      const serviceId = r["dt.smartscape.service"] as string;
      const ratio = r.fan_out as number;
      if (serviceId && typeof ratio === "number" && isFinite(ratio)) {
        ratios.set(serviceId, ratio);
      }
    }
    return ratios;
  } catch {
    // Span data may not be available — return empty map
    return new Map();
  }
}

export function useSmartscapeTopology(options: TopologyOptions): UseSmartscapeTopologyResult {
  const [graph, setGraph] = useState<TopologyGraph>(createGraph);
  const [status, setStatus] = useState<TopologyStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const { timeframeDql, nodeTypes, maxNodes = 1000 } = options;

  const buildGraph = useCallback(async () => {
    const generation = ++generationRef.current;
    setStatus("loading");
    setError(null);

    try {
      // Phase 1: Fetch nodes and edges in parallel (skip fan-out initially)
      const [nodes, edges] = await Promise.all([
        fetchNodes(nodeTypes, maxNodes),
        fetchEdges(maxNodes * 3),
      ]);

      // Stale check — a newer request was triggered
      if (generation !== generationRef.current) return;

      const g = createGraph();

      for (const n of nodes) {
        addNode(g, n.id, n.name, n.type, n.metadata);
      }

      // Only add edges where BOTH endpoints exist in our node set
      for (const e of edges) {
        if (!g.nodes.has(e.sourceId) || !g.nodes.has(e.targetId)) continue;

        addEdge(g, {
          sourceId: e.sourceId,
          targetId: e.targetId,
          sourceType: e.sourceType,
          targetType: e.targetType,
          edgeType: e.edgeType,
          fanOutRatio: 1.0, // will be enriched async
          edgeKind: e.edgeKind,
        });
      }

      setGraph(g);
      setStatus("success");

      // Phase 2: Enrich fan-out ratios in background (non-blocking)
      fetchFanOutRatios(timeframeDql).then((fanOutRatios) => {
        if (generation !== generationRef.current) return;
        if (fanOutRatios.size === 0) return;
        for (const edge of g.edges) {
          if (edge.edgeType === "calls" && edge.sourceType === "SERVICE") {
            edge.fanOutRatio = fanOutRatios.get(edge.sourceId) ?? 1.0;
          }
        }
      }).catch(() => { /* fan-out is best-effort */ });

    } catch (err: unknown) {
      if (generation !== generationRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to build topology graph");
      setStatus("error");
    }
  }, [timeframeDql, nodeTypes, maxNodes]);

  useEffect(() => {
    void buildGraph();
  }, [buildGraph]);

  return {
    graph,
    status,
    error,
    reload: () => { void buildGraph(); },
    nodeCount: graph.nodes.size,
    edgeCount: graph.edges.length,
  };
}
