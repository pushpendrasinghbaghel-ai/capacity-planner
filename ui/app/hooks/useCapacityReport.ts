// ============================================================
// useCapacityReport — Multi-horizon Davis AI capacity forecast
// Generates capacity projections for 3, 6, 9, 12 months
// ============================================================

import { useState, useCallback, useRef, useEffect } from "react";
import { analyzersClient } from "@dynatrace-sdk/client-davis-analyzers";
import type { TopologyNode, BottleneckSeverity } from "../types";
import { classifySeverity, getRecommendationText } from "../lib/capacity";
import { sanitizeEntityId } from "../utils/formatting";

export const HORIZONS = [
  { label: "3 Months", days: 90, key: "3m" },
  { label: "6 Months", days: 180, key: "6m" },
  { label: "9 Months", days: 270, key: "9m" },
  { label: "12 Months", days: 365, key: "12m" },
] as const;

export type HorizonKey = (typeof HORIZONS)[number]["key"];

export interface MetricForecast {
  metricKey: string;
  metricLabel: string;
  currentValue: number;
  forecastedValue: number;
  upperBound: number;
  lowerBound: number;
  severity: BottleneckSeverity;
  headroomPct: number;
}

export interface HorizonForecast {
  horizonKey: HorizonKey;
  horizonLabel: string;
  horizonDays: number;
  metrics: MetricForecast[];
  overallSeverity: BottleneckSeverity;
  recommendation: string;
}

export interface CapacityReportData {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  generatedAt: string;
  horizons: HorizonForecast[];
}

type ReportStatus = "idle" | "loading" | "success" | "error";

export interface UseCapacityReportResult {
  report: CapacityReportData | null;
  status: ReportStatus;
  error: string | null;
  generate: (node: TopologyNode) => void;
  clear: () => void;
}

const FORECAST_METRICS = [
  { key: "dt.host.cpu.usage", agg: "avg", label: "CPU Usage %" },
  { key: "dt.host.memory.usage", agg: "avg", label: "Memory Usage %" },
  { key: "dt.host.disk.used.percent", agg: "avg", label: "Disk Usage %" },
];

async function forecastMetric(
  hostId: string,
  metricKey: string,
  aggregation: string,
  forecastHorizon: number
): Promise<{
  current: number;
  point: number;
  upper: number;
  lower: number;
} | null> {
  try {
    const response = await analyzersClient.executeAnalyzer({
      analyzerName: "dt.statistics.GenericForecastAnalyzer",
      body: {
        timeSeriesData: {
          expression: `timeseries ${aggregation}(${metricKey}), filter:{dt.smartscape.host == "${sanitizeEntityId(hostId)}"}`,
        },
        forecastHorizon: Math.min(forecastHorizon, 400),
        forecastOffset: 1,
        generalParameters: {
          timeframe: { startTime: "now-30d" },
        },
      },
    });

    const analyzerResult = response.result;
    if (!analyzerResult || analyzerResult.resultStatus === "FAILED") return null;

    const output = analyzerResult.output?.[0];
    if (!output) return null;

    const record = (output as any).resultTimeseries?.records?.[0];
    if (!record) return null;

    // Find the historical metric field
    const metricField = Object.keys(record).find(
      (k) =>
        !k.startsWith("dt.davis.forecast") &&
        !["timeframe", "interval", "dt.entity.host"].includes(k)
    );

    const historical = metricField ? (record[metricField] as number[]) : [];
    const forecastPoints = (record["dt.davis.forecast:point"] as number[]) ?? [];
    const forecastUppers = (record["dt.davis.forecast:upper"] as number[]) ?? [];
    const forecastLowers = (record["dt.davis.forecast:lower"] as number[]) ?? [];

    // Current = last historical value
    const current = historical.length > 0
      ? historical.filter((v) => v != null).pop() ?? 0
      : 0;

    // Forecasted = last point in forecast horizon
    const lastIdx = forecastPoints.length - 1;
    if (lastIdx < 0) return null;

    return {
      current,
      point: forecastPoints[lastIdx] ?? 0,
      upper: forecastUppers[lastIdx] ?? forecastPoints[lastIdx] ?? 0,
      lower: forecastLowers[lastIdx] ?? forecastPoints[lastIdx] ?? 0,
    };
  } catch {
    return null;
  }
}

function worstSeverity(severities: BottleneckSeverity[]): BottleneckSeverity {
  if (severities.includes("critical")) return "critical";
  if (severities.includes("warning")) return "warning";
  if (severities.includes("over_provisioned")) return "over_provisioned";
  return "healthy";
}

export function useCapacityReport(): UseCapacityReportResult {
  const [report, setReport] = useState<CapacityReportData | null>(null);
  const [status, setStatus] = useState<ReportStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const generate = useCallback((node: TopologyNode) => {
    setStatus("loading");
    setError(null);

    void (async () => {
      try {
        const horizons: HorizonForecast[] = [];

        for (const horizon of HORIZONS) {
          if (!mountedRef.current) return;
          const metricResults = await Promise.all(
            FORECAST_METRICS.map(async (m) => {
              const result = await forecastMetric(node.id, m.key, m.agg, horizon.days);
              if (!result) return null;

              const projected = Math.min(result.upper, 100);
              const severity = classifySeverity(projected);
              const headroom = Math.max(0, 100 - projected);

              return {
                metricKey: m.key,
                metricLabel: m.label,
                currentValue: result.current,
                forecastedValue: Math.min(result.point, 100),
                upperBound: projected,
                lowerBound: Math.max(result.lower, 0),
                severity,
                headroomPct: headroom,
              } satisfies MetricForecast;
            })
          );

          const validMetrics = metricResults.filter((m): m is MetricForecast => m !== null);
          const overallSeverity = worstSeverity(validMetrics.map((m) => m.severity));

          // Find the worst metric for recommendation
          const worstMetric = validMetrics.reduce(
            (a, b) => (a.upperBound > b.upperBound ? a : b),
            validMetrics[0]
          );

          const recommendation = worstMetric
            ? getRecommendationText(
                overallSeverity,
                node.type,
                worstMetric.upperBound,
                node.limits.canScaleHorizontally
              )
            : "Insufficient data for forecast.";

          horizons.push({
            horizonKey: horizon.key,
            horizonLabel: horizon.label,
            horizonDays: horizon.days,
            metrics: validMetrics,
            overallSeverity,
            recommendation: `[Davis AI — ${horizon.label}] ${recommendation}`,
          });
        }

        if (!mountedRef.current) return;
        setReport({
          nodeId: node.id,
          nodeName: node.name,
          nodeType: node.type,
          generatedAt: new Date().toISOString(),
          horizons,
        });
        setStatus("success");
      } catch (err: unknown) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : "Capacity report generation failed");
        setStatus("error");
      }
    })();
  }, []);

  const clear = useCallback(() => {
    setReport(null);
    setStatus("idle");
    setError(null);
  }, []);

  return { report, status, error, generate, clear };
}
