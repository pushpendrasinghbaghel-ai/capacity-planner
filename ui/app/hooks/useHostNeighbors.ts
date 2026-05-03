// ============================================================
// useHostNeighbors — Fetch Smartscape neighbors for a host
// Returns upstream/downstream services, processes, containers
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { sanitizeEntityId } from "../utils/formatting";

export interface NeighborNode {
  id: string;
  name: string;
  type: string;
  direction: "upstream" | "downstream" | "runs_on";
  edgeType: string;
}

interface UseHostNeighborsResult {
  neighbors: NeighborNode[];
  status: "idle" | "loading" | "success" | "error";
  error: string | null;
}

async function executeDql(query: string): Promise<Record<string, unknown>[]> {
  const response = await queryExecutionClient.queryExecute({
    body: { query, requestTimeoutMilliseconds: 20000, maxResultRecords: 500 },
  });
  if (response.state === "SUCCEEDED") {
    return (response.result?.records as Record<string, unknown>[]) ?? [];
  }
  if (response.requestToken) {
    let attempts = 0;
    while (attempts < 20) {
      await new Promise((r) => setTimeout(r, 1000));
      const poll = await queryExecutionClient.queryPoll({ requestToken: response.requestToken });
      if (poll.state === "SUCCEEDED") return (poll.result?.records as Record<string, unknown>[]) ?? [];
      if (poll.state === "FAILED" || poll.state === "CANCELLED") throw new Error(`Query ${poll.state}`);
      attempts++;
    }
  }
  return [];
}

export function useHostNeighbors(hostId: string | null): UseHostNeighborsResult {
  const [neighbors, setNeighbors] = useState<NeighborNode[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const load = useCallback(async () => {
    if (!hostId) { setStatus("idle"); return; }
    const generation = ++generationRef.current;
    setStatus("loading");
    setError(null);

    try {
      const safeId = sanitizeEntityId(hostId);

      // Outgoing edges from this host (things that run on it, it connects to)
      const outEdges = await executeDql(
        `smartscapeEdges "calls", "runs_on", "belongs_to", "contains", "balanced_by", "is_part_of", "uses"
| filter toString(source_id) == "${safeId}"
| fieldsAdd tgt = toString(target_id)
| lookup [smartscapeNodes "*" | fieldsAdd nid = toString(id) | fields nid, name, type], sourceField:tgt, lookupField:nid
| fields tgt, type, lookup.name, lookup.type`
      );

      // Incoming edges to this host (things that call/depend on it)
      const inEdges = await executeDql(
        `smartscapeEdges "calls", "runs_on", "belongs_to", "contains", "balanced_by", "is_part_of", "uses"
| filter toString(target_id) == "${safeId}"
| fieldsAdd src = toString(source_id)
| lookup [smartscapeNodes "*" | fieldsAdd nid = toString(id) | fields nid, name, type], sourceField:src, lookupField:nid
| fields src, type, lookup.name, lookup.type`
      );

      if (generation !== generationRef.current) return;

      const result: NeighborNode[] = [];
      const seen = new Set<string>();

      for (const r of outEdges) {
        const id = r.tgt as string;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const edgeType = (r.type as string) ?? "unknown";
        result.push({
          id,
          name: (r["lookup.name"] as string) ?? id,
          type: (r["lookup.type"] as string) ?? "UNKNOWN",
          direction: edgeType === "runs_on" ? "runs_on" : "downstream",
          edgeType,
        });
      }
      for (const r of inEdges) {
        const id = r.src as string;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        result.push({
          id,
          name: (r["lookup.name"] as string) ?? id,
          type: (r["lookup.type"] as string) ?? "UNKNOWN",
          direction: "upstream",
          edgeType: (r.type as string) ?? "unknown",
        });
      }

      setNeighbors(result);
      setStatus("success");
    } catch (err: unknown) {
      if (generation !== generationRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load neighbors");
      setStatus("error");
    }
  }, [hostId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { neighbors, status, error };
}
