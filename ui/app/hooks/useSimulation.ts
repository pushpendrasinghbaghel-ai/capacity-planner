// ============================================================
// useSimulation — AI-powered what-if simulation engine
// Uses Davis GenericForecastAnalyzer for host-level predictions
// and multiplier propagation for non-host nodes
// ============================================================

import { useState, useCallback, useRef, useEffect } from "react";
import { analyzersClient } from "@dynatrace-sdk/client-davis-analyzers";
import type {
  TopologyGraph,
  TopologyNode,
  Scenario,
  SimulationResult,
  NodeSimulationResult,
  BottleneckSeverity,
} from "../types";
import { propagateMultiplier } from "../lib/graph";
import {
  classifySeverity,
  getNodeUtilization,
  computeHeadroom,
  getConstraintMetrics,
  getRecommendationText,
} from "../lib/capacity";
import { sanitizeEntityId } from "../utils/formatting";

type SimulationStatus = "idle" | "running" | "done" | "error";

interface UseSimulationResult {
  result: SimulationResult | null;
  status: SimulationStatus;
  error: string | null;
  run: (scenario: Scenario) => void;
  clear: () => void;
}

/** Extract the base multiplier from scenario params */
function getBaseMultiplier(scenario: Scenario): number {
  const p = scenario.params;
  switch (p.type) {
    case "traffic_growth":
      return p.multiplier;
    case "seasonal_spike":
      return p.peakMultiplier;
    case "data_growth":
      return p.monthlyGrowthRate;
    case "database_scaling":
      return p.queryMultiplier;
    case "right_sizing":
      return 1.0;
    default:
      return 1.0;
  }
}

/** Host-level metrics to forecast via Davis */
const FORECAST_METRICS = [
  { key: "dt.host.cpu.usage", aggregation: "avg", field: "cpuAvg" },
  { key: "dt.host.memory.usage", aggregation: "avg", field: "memoryAvg" },
  { key: "dt.host.disk.used.percent", aggregation: "avg", field: "diskUsedPct" },
] as const;

/**
 * Run Davis GenericForecastAnalyzer for a host metric.
 * Returns the upper-bound forecast value (worst-case projected utilization).
 */
async function davisForecastMetric(
  hostId: string,
  metricKey: string,
  aggregation: string,
  horizonDays: number
): Promise<{ point: number; upper: number; lower: number } | null> {
  try {
    const forecastHorizon = Math.max(1, Math.min(horizonDays, 180));
    const response = await analyzersClient.executeAnalyzer({
      analyzerName: "dt.statistics.GenericForecastAnalyzer",
      body: {
        timeSeriesData: {
            expression: `timeseries ${aggregation}(${metricKey}), filter:{dt.smartscape.host == "${sanitizeEntityId(hostId)}"}`,
        },
        forecastHorizon,
        forecastOffset: 1,
        generalParameters: {
          timeframe: { startTime: "now-14d" },
        },
      },
    });

    const analyzerResult = response.result;
    if (!analyzerResult || analyzerResult.resultStatus === "FAILED") return null;

    const output = analyzerResult.output?.[0];
    if (!output) return null;

    const record = (output as any).resultTimeseries?.records?.[0];
    if (!record) return null;

    const forecastPoints = record["dt.davis.forecast:point"] as number[] | undefined;
    const forecastUppers = record["dt.davis.forecast:upper"] as number[] | undefined;
    const forecastLowers = record["dt.davis.forecast:lower"] as number[] | undefined;

    if (!forecastPoints?.length) return null;

    // Take the last forecast data point (end of horizon)
    const lastIdx = forecastPoints.length - 1;
    return {
      point: forecastPoints[lastIdx] ?? 0,
      upper: forecastUppers?.[lastIdx] ?? forecastPoints[lastIdx] ?? 0,
      lower: forecastLowers?.[lastIdx] ?? forecastPoints[lastIdx] ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Run Davis forecasts for a host node across CPU, memory, disk.
 * Returns the max projected utilization (upper bound) across all metrics.
 */
async function forecastHostNode(
  node: TopologyNode,
  multiplier: number,
  horizonDays: number
): Promise<{ projectedUtil: number; forecastSource: string; constraintMetric: string }> {
  const forecasts = await Promise.all(
    FORECAST_METRICS.map(async (m) => {
      const result = await davisForecastMetric(node.id, m.key, m.aggregation, horizonDays);
      if (result) {
        // Apply scenario multiplier on top of Davis forecast
        // Davis predicts organic growth; multiplier represents additional load
        const adjustedUpper = Math.min(result.upper * multiplier, 100);
        return { metric: m.field, projected: adjustedUpper };
      }
      return null;
    })
  );

  const validForecasts = forecasts.filter((f): f is NonNullable<typeof f> => f !== null);
  if (validForecasts.length > 0) {
    // Use the metric with the highest projected utilization (most constrained)
    const worst = validForecasts.reduce((a, b) => (a.projected > b.projected ? a : b));
    return {
      projectedUtil: worst.projected,
      forecastSource: "davis",
      constraintMetric: worst.metric,
    };
  }

  // Fallback: static multiplier if Davis forecast unavailable
  const currentUtil = getNodeUtilization(node);
  return {
    projectedUtil: Math.min(currentUtil * multiplier, 100),
    forecastSource: "static",
    constraintMetric: "cpu",
  };
}

export function useSimulation(graph: TopologyGraph): UseSimulationResult {
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [status, setStatus] = useState<SimulationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const runningRef = useRef(false);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const run = useCallback(
    (scenario: Scenario) => {
      if (graph.nodes.size === 0) {
        setError("No topology data available. Load the topology first.");
        setStatus("error");
        return;
      }

      if (scenario.entryPoints.length === 0) {
        setError("No entry points selected. Pick at least one node to simulate from.");
        setStatus("error");
        return;
      }

      if (runningRef.current) return; // Prevent double-execution
      runningRef.current = true;
      setStatus("running");
      setError(null);

      // Run async simulation with Davis forecasts
      void (async () => {
        try {
          const multiplier = getBaseMultiplier(scenario);
          const horizonDays = scenario.horizonDays || 90;

          // Propagate multiplier through the graph
          const propagation = propagateMultiplier(
            graph,
            scenario.entryPoints,
            multiplier,
            20
          );

          // Identify host nodes for Davis forecasting (batch up to 10 to avoid overloading)
          const hostNodeIds = propagation.visitOrder.filter((id) => {
            const node = graph.nodes.get(id);
            return node && (node.type === "HOST" || node.type === "AWS_EC2_INSTANCE");
          });
          const forecastableHosts = hostNodeIds.slice(0, 10);

          // Run Davis forecasts for hosts in parallel
          const davisResults = new Map<string, { projectedUtil: number; forecastSource: string; constraintMetric: string }>();
          const forecastPromises = forecastableHosts.map(async (hostId) => {
            const node = graph.nodes.get(hostId)!;
            const hostMultiplier = propagation.multipliers.get(hostId) ?? 1;
            const forecastResult = await forecastHostNode(node, hostMultiplier, horizonDays);
            davisResults.set(hostId, forecastResult);
          });
          await Promise.all(forecastPromises);

          // Build per-node results
          const nodeResults: NodeSimulationResult[] = [];
          for (const nodeId of propagation.visitOrder) {
            const node = graph.nodes.get(nodeId);
            if (!node) continue;

            const nodeMultiplier = propagation.multipliers.get(nodeId) ?? 1;
            const currentUtil = getNodeUtilization(node);

            let projectedUtil: number;
            let forecastSource: string;

            const davisResult = davisResults.get(nodeId);
            if (davisResult) {
              // Use Davis AI forecast for this node
              projectedUtil = davisResult.projectedUtil;
              forecastSource = davisResult.forecastSource;
            } else {
              // Non-host nodes: use multiplier propagation
              projectedUtil = Math.min(currentUtil * nodeMultiplier, 100);
              forecastSource = "static";
            }

            const headroom = computeHeadroom(projectedUtil, 100);
            const severity = classifySeverity(projectedUtil);
            const constraintMetrics = getConstraintMetrics(node);

            // Days to exhaustion: use Davis-informed projection rate
            let daysToExhaustion: number | null = null;
            if (projectedUtil >= 85 && projectedUtil > currentUtil) {
              const ratePerDay = (projectedUtil - currentUtil) / horizonDays;
              if (ratePerDay > 0) {
                daysToExhaustion = Math.round((100 - currentUtil) / ratePerDay);
              }
            }

            const recommendation = getRecommendationText(
              severity,
              node.type,
              projectedUtil,
              node.limits.canScaleHorizontally
            );

            nodeResults.push({
              nodeId: node.id,
              nodeName: node.name,
              nodeType: node.type,
              effectiveMultiplier: nodeMultiplier,
              currentUtilization: currentUtil,
              projectedUtilization: projectedUtil,
              headroomPct: headroom,
              severity,
              recommendation: forecastSource === "davis"
                ? `[Davis AI] ${recommendation}`
                : recommendation,
              daysToExhaustion,
              constraintMetrics,
            });
          }

          // Sort bottlenecks
          const severityOrder: Record<BottleneckSeverity, number> = {
            critical: 0, warning: 1, over_provisioned: 2, healthy: 3,
          };
          const bottlenecks = [...nodeResults].sort((a, b) => {
            const sDiff = severityOrder[a.severity] - severityOrder[b.severity];
            if (sDiff !== 0) return sDiff;
            return b.projectedUtilization - a.projectedUtilization;
          });

          // Critical path
          const firstBottleneck = bottlenecks.find(
            (n) => n.severity === "critical" || n.severity === "warning"
          );
          const criticalPath = firstBottleneck
            ? propagation.paths.get(firstBottleneck.nodeId) ?? []
            : [];

          if (!mountedRef.current) { runningRef.current = false; return; }
          setResult({
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            nodeResults,
            bottlenecks,
            criticalPath,
            nodesAnalyzed: nodeResults.length,
            timestamp: new Date().toISOString(),
          });
          setStatus("done");
          runningRef.current = false;
        } catch (err: unknown) {
          runningRef.current = false;
          if (!mountedRef.current) return;
          setError(err instanceof Error ? err.message : "Simulation failed");
          setStatus("error");
        }
      })();
    },
    [graph]
  );

  const clear = useCallback(() => {
    setResult(null);
    setStatus("idle");
    setError(null);
  }, []);

  return { result, status, error, run, clear };
}
