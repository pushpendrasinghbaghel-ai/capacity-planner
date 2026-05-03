// ============================================================
// useMetricsOverlay — Fetch and attach metrics to topology nodes
// Deferred: only loads when topology is ready (graph.nodes.size > 0)
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import type { TopologyGraph } from "../types";

type MetricsStatus = "idle" | "loading" | "success" | "error";

interface UseMetricsOverlayResult {
  status: MetricsStatus;
  error: string | null;
  reload: () => void;
}

async function executeDql(query: string): Promise<Record<string, unknown>[]> {
  const response = await queryExecutionClient.queryExecute({
    body: {
      query,
      requestTimeoutMilliseconds: 30000,
      maxResultRecords: 5000,
    },
  });

  if (response.state === "SUCCEEDED") {
    return (response.result?.records as Record<string, unknown>[]) ?? [];
  }

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
        throw new Error(`Query ${pollResponse.state}`);
      }
      attempts++;
    }
  }

  return [];
}

/** Fetch host-level metrics (CPU, memory, disk) */
async function fetchHostMetrics(timeframeDql: string): Promise<
  Map<string, { cpuAvg: number; memoryAvg: number; diskUsedPct: number }>
> {
  const query = `timeseries {
  cpu = avg(dt.host.cpu.usage),
  mem = avg(dt.host.memory.usage),
  disk = avg(dt.host.disk.used.percent)
}, by: {dt.smartscape.host}, ${timeframeDql}
| fieldsAdd cpu_val = arrayAvg(cpu), mem_val = arrayAvg(mem), disk_val = arrayAvg(disk)
| fields dt.smartscape.host, cpu_val, mem_val, disk_val`;

  const records = await executeDql(query);
  const metrics = new Map<string, { cpuAvg: number; memoryAvg: number; diskUsedPct: number }>();

  for (const r of records) {
    const hostId = r["dt.smartscape.host"] as string;
    if (!hostId) continue;
    metrics.set(hostId, {
      cpuAvg: (r.cpu_val as number) ?? 0,
      memoryAvg: (r.mem_val as number) ?? 0,
      diskUsedPct: (r.disk_val as number) ?? 0,
    });
  }

  return metrics;
}

/** Fetch service-level RED metrics */
async function fetchServiceMetrics(timeframeDql: string): Promise<
  Map<string, { requestRate: number; errorRate: number; responseTimeP95: number }>
> {
  const query = `timeseries {
  requests = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count),
  resp_time = percentile(dt.service.request.response_time, 95)
}, by: {dt.smartscape.service}, ${timeframeDql}
| fieldsAdd req_avg = arrayAvg(requests), fail_avg = arrayAvg(failures), rt_avg = arrayAvg(resp_time)
| fields dt.smartscape.service, req_avg, fail_avg, rt_avg`;

  const records = await executeDql(query);
  const metrics = new Map<
    string,
    { requestRate: number; errorRate: number; responseTimeP95: number }
  >();

  for (const r of records) {
    const serviceId = r["dt.smartscape.service"] as string;
    if (!serviceId) continue;
    const reqAvg = (r.req_avg as number) ?? 0;
    const failAvg = (r.fail_avg as number) ?? 0;
    metrics.set(serviceId, {
      requestRate: reqAvg,
      errorRate: reqAvg > 0 ? (failAvg / reqAvg) * 100 : 0,
      responseTimeP95: (r.rt_avg as number) ?? 0,
    });
  }

  return metrics;
}

/**
 * Attaches metrics to nodes in the given graph (mutates in place).
 * Deferred: waits until graph has nodes before fetching.
 */
export function useMetricsOverlay(
  graph: TopologyGraph,
  timeframeDql: string
): UseMetricsOverlayResult {
  const [status, setStatus] = useState<MetricsStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const loadMetrics = useCallback(async () => {
    if (graph.nodes.size === 0) return;

    const generation = ++generationRef.current;
    setStatus("loading");
    setError(null);

    try {
      const [hostMetrics, serviceMetrics] = await Promise.all([
        fetchHostMetrics(timeframeDql),
        fetchServiceMetrics(timeframeDql),
      ]);

      // Attach host metrics
      for (const [hostId, m] of hostMetrics) {
        if (generation !== generationRef.current) return;
        const node = graph.nodes.get(hostId);
        if (node) {
          node.metrics.cpuAvg = m.cpuAvg;
          node.metrics.memoryAvg = m.memoryAvg;
          node.metrics.diskUsedPct = m.diskUsedPct;
        }
      }

      // Attach service metrics
      for (const [serviceId, m] of serviceMetrics) {
        const node = graph.nodes.get(serviceId);
        if (node) {
          node.metrics.requestRate = m.requestRate;
          node.metrics.errorRate = m.errorRate;
          node.metrics.responseTimeP95 = m.responseTimeP95;
        }
      }

      if (generation !== generationRef.current) return;
      setStatus("success");
    } catch (err: unknown) {
      if (generation !== generationRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load metrics");
      setStatus("error");
    }
  }, [graph, timeframeDql]);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  return { status, error, reload: () => { void loadMetrics(); } };
}
