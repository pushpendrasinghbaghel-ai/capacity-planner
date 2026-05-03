// ============================================================
// useFleetHealth — Fetch host fleet utilization metrics
// Returns a flat table of all hosts with CPU/memory/disk metrics
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import type { BottleneckSeverity } from "../types";
import { classifySeverity } from "../lib/capacity";

export interface HostHealthRow {
  id: string;
  name: string;
  cpuAvg: number | null;
  memoryAvg: number | null;
  diskUsedPct: number | null;
  /** Worst severity across all metrics */
  severity: BottleneckSeverity;
  /** The metric that determines severity */
  constraintMetric: string;
  /** Number of metric data points available (higher = more data for forecast) */
  dataPoints: number;
  /** True if host has enough data points for Davis forecast (>= 10) */
  forecastReady: boolean;
}

interface UseFleetHealthResult {
  hosts: HostHealthRow[];
  status: "idle" | "loading" | "success" | "error";
  error: string | null;
  reload: () => void;
  summary: {
    total: number;
    critical: number;
    warning: number;
    healthy: number;
    overProvisioned: number;
  };
}

async function executeDql(query: string): Promise<Record<string, unknown>[]> {
  const response = await queryExecutionClient.queryExecute({
    body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: 5000 },
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

function worstSeverity(
  cpu: number | null,
  mem: number | null,
  disk: number | null
): { severity: BottleneckSeverity; constraint: string } {
  const metrics = [
    { name: "CPU", value: cpu },
    { name: "Memory", value: mem },
    { name: "Disk", value: disk },
  ].filter((m) => m.value != null) as Array<{ name: string; value: number }>;

  if (metrics.length === 0) return { severity: "healthy", constraint: "—" };

  let worstMetric = metrics[0];
  for (const m of metrics) {
    if (m.value > worstMetric.value) worstMetric = m;
  }

  return {
    severity: classifySeverity(worstMetric.value),
    constraint: worstMetric.name,
  };
}

export function useFleetHealth(timeframeDql: string): UseFleetHealthResult {
  const [hosts, setHosts] = useState<HostHealthRow[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const loadFleet = useCallback(async () => {
    const generation = ++generationRef.current;
    setStatus("loading");
    setError(null);

    try {
      // Get host list
      const hostRecords = await executeDql(
        `smartscapeNodes "HOST"
| fields sid = id, name
| fieldsAdd id = toString(sid)
| fields id, name
| sort name asc
| limit 500`
      );
      if (generation !== generationRef.current) return;

      // Get host metrics — also count data points to determine forecast readiness
      const metricRecords = await executeDql(
        `timeseries {
  cpu = avg(dt.host.cpu.usage),
  mem = avg(dt.host.memory.usage),
  disk = avg(dt.host.disk.used.percent)
}, by: {dt.smartscape.host}, ${timeframeDql}
| fieldsAdd cpu_val = arrayAvg(cpu), mem_val = arrayAvg(mem), disk_val = arrayAvg(disk)
| fieldsAdd cpu_pts = arraySize(cpu)
| fields dt.smartscape.host, cpu_val, mem_val, disk_val, cpu_pts`
      );
      if (generation !== generationRef.current) return;

      // Build metrics map (host ID → metrics + data point count)
      const metricsMap = new Map<string, { cpu: number | null; mem: number | null; disk: number | null; pts: number }>();
      for (const r of metricRecords) {
        const hostId = r["dt.smartscape.host"] as string;
        if (!hostId) continue;
        metricsMap.set(hostId, {
          cpu: typeof r.cpu_val === "number" ? r.cpu_val : null,
          mem: typeof r.mem_val === "number" ? r.mem_val : null,
          disk: typeof r.disk_val === "number" ? r.disk_val : null,
          pts: Number(r.cpu_pts) || 0,
        });
      }

      // Merge
      const rows: HostHealthRow[] = hostRecords.map((r) => {
        const id = r.id as string;
        const name = (r.name as string) ?? id;
        const m = metricsMap.get(id);
        const cpu = m?.cpu ?? null;
        const mem = m?.mem ?? null;
        const disk = m?.disk ?? null;
        const pts = m?.pts ?? 0;
        const { severity, constraint } = worstSeverity(cpu, mem, disk);
        return { id, name, cpuAvg: cpu, memoryAvg: mem, diskUsedPct: disk, severity, constraintMetric: constraint, dataPoints: pts, forecastReady: pts >= 10 };
      });

      // Sort by severity then worst metric
      const severityOrder: Record<BottleneckSeverity, number> = { critical: 0, warning: 1, over_provisioned: 2, healthy: 3 };
      rows.sort((a, b) => {
        const sd = severityOrder[a.severity] - severityOrder[b.severity];
        if (sd !== 0) return sd;
        const aMax = Math.max(a.cpuAvg ?? 0, a.memoryAvg ?? 0, a.diskUsedPct ?? 0);
        const bMax = Math.max(b.cpuAvg ?? 0, b.memoryAvg ?? 0, b.diskUsedPct ?? 0);
        return bMax - aMax;
      });

      setHosts(rows);
      setStatus("success");
    } catch (err: unknown) {
      if (generation !== generationRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load fleet health");
      setStatus("error");
    }
  }, [timeframeDql]);

  useEffect(() => {
    void loadFleet();
  }, [loadFleet]);

  const summary = {
    total: hosts.length,
    critical: hosts.filter((h) => h.severity === "critical").length,
    warning: hosts.filter((h) => h.severity === "warning").length,
    healthy: hosts.filter((h) => h.severity === "healthy").length,
    overProvisioned: hosts.filter((h) => h.severity === "over_provisioned").length,
  };

  return { hosts, status, error, reload: () => { void loadFleet(); }, summary };
}
