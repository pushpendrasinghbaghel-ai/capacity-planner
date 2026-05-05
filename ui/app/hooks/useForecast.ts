import { useState, useEffect, useCallback, useRef } from "react";
import { analyzersClient } from "@dynatrace-sdk/client-davis-analyzers";
import type { Timeframe } from "@dynatrace/strato-components/core";
import { getTimeframeForDavis } from "../context/FilterContext";
import { sanitizeEntityId } from "../utils/formatting";

export type ForecastResult = {
  historical: number[];
  forecastPoint: number[];
  forecastUpper: number[];
  forecastLower: number[];
  timeframe: { start: string; end: string };
  interval: number;
  historicalTimeframe: { start: string; end: string };
  historicalInterval: number;
  status: "idle" | "loading" | "success" | "error";
  error: string | null;
};

type MetricConfig = {
  key: string;
  aggregation: string;
  label: string;
};

export const METRICS: Record<string, MetricConfig> = {
  cpu: { key: "dt.host.cpu.usage", aggregation: "avg", label: "CPU Usage %" },
  memory: { key: "dt.host.memory.usage", aggregation: "avg", label: "Memory Usage %" },
  disk: { key: "dt.host.disk.used.percent", aggregation: "avg", label: "Disk Usage %" },
};

export function useForecast(hostId: string | null, metricId: string, timeframe?: Timeframe | null, forecastHorizon: number = 48, queryInterval?: string, spikeMultiplier: number = 1) {
  const [result, setResult] = useState<ForecastResult>({
    historical: [],
    forecastPoint: [],
    forecastUpper: [],
    forecastLower: [],
    timeframe: { start: "", end: "" },
    interval: 0,
    historicalTimeframe: { start: "", end: "" },
    historicalInterval: 0,
    status: "idle",
    error: null,
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const runForecast = useCallback(async () => {
    if (!hostId) return;

    const metric = METRICS[metricId];
    if (!metric) return;

    setResult((prev) => ({ ...prev, status: "loading", error: null }));

    try {
      // Davis needs sufficient historical data points to build a forecast model.
      // When using daily intervals for longer horizons, widen the historical
      // timeframe so Davis gets at least ~90 data points of history.
      let davisTimeframe = getTimeframeForDavis(timeframe ?? null);
      if (queryInterval) {
        const intervalDays = queryInterval === "1d" ? 1 : queryInterval === "1h" ? 1 / 24 : 0;
        if (intervalDays > 0) {
          const minHistoryDays = Math.max(90, forecastHorizon * intervalDays);
          davisTimeframe = { startTime: `now-${Math.ceil(minHistoryDays)}d` };
        }
      }

      // Build DQL expression — when spike multiplier > 1, scale the timeseries
      // so Davis computes proper statistical confidence intervals on the spiked data
      const baseExpr = spikeMultiplier > 1
        ? `timeseries val = ${metric.aggregation}(${metric.key}), filter:{dt.smartscape.host == "${sanitizeEntityId(hostId)}"}${queryInterval ? `, interval: ${queryInterval}` : ""} | fieldsAdd val = val[] * ${spikeMultiplier}`
        : `timeseries ${metric.aggregation}(${metric.key}), filter:{dt.smartscape.host == "${sanitizeEntityId(hostId)}"}${queryInterval ? `, interval: ${queryInterval}` : ""}`;

      const response = await analyzersClient.executeAnalyzer({
        analyzerName: "dt.statistics.GenericForecastAnalyzer",
        body: {
          timeSeriesData: {
            expression: baseExpr,
          },
          forecastHorizon: Math.min(forecastHorizon, 400),
          forecastOffset: 1,
          generalParameters: {
            timeframe: davisTimeframe,
          },
        },
      });

      const { result: analyzerResult } = response;
      if (!analyzerResult || analyzerResult.resultStatus === "FAILED") {
        if (!mountedRef.current) return;
        setResult((prev) => ({
          ...prev,
          status: "error",
          error: `Forecast failed: ${analyzerResult?.resultStatus ?? "unknown"}`,
        }));
        return;
      }

      const output = analyzerResult.output[0];
      if (!output) {
        if (!mountedRef.current) return;
        setResult((prev) => ({
          ...prev,
          status: "error",
          error: "No forecast output returned",
        }));
        return;
      }

      // GenericForecastAnalyzer returns two structures:
      // - analyzedTimeSeriesQuery.expression.records[0] = historical data
      // - timeSeriesDataWithPredictions.records[0] = forecast data (lower/upper/point only)
      const predictionRecord = (output as any).timeSeriesDataWithPredictions?.records?.[0];
      const historicalRecord = (output as any).analyzedTimeSeriesQuery?.expression?.records?.[0];
      if (!predictionRecord) {
        if (!mountedRef.current) return;
        setResult((prev) => ({
          ...prev,
          status: "error",
          error: "No forecast data returned",
        }));
        return;
      }

      // Historical metric values are in a separate record under analyzedTimeSeriesQuery
      const metricField = historicalRecord
        ? Object.keys(historicalRecord).find(
            (k) =>
              !k.startsWith("dt.davis.forecast") &&
              !["timeframe", "interval", "dt.entity.host", "dt.smartscape.host"].includes(k)
          )
        : undefined;

      const parseInterval = (raw: unknown) =>
        typeof raw === "string"
          ? parseInt(raw, 10) / 1_000_000
          : typeof raw === "number"
            ? raw / 1_000_000
            : 3_600_000; // fallback: 1 hour in ms

      if (!mountedRef.current) return;
      setResult({
        historical: metricField ? (historicalRecord[metricField] as number[]) : [],
        forecastPoint: (predictionRecord["dt.davis.forecast:point"] as number[]) ?? [],
        forecastUpper: (predictionRecord["dt.davis.forecast:upper"] as number[]) ?? [],
        forecastLower: (predictionRecord["dt.davis.forecast:lower"] as number[]) ?? [],
        timeframe: predictionRecord.timeframe as { start: string; end: string },
        interval: parseInterval(predictionRecord.interval),
        historicalTimeframe: (historicalRecord?.timeframe as { start: string; end: string }) ?? predictionRecord.timeframe,
        historicalInterval: parseInterval(historicalRecord?.interval ?? predictionRecord.interval),
        status: "success",
        error: null,
      });
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      setResult((prev) => ({
        ...prev,
        status: "error",
        error: err instanceof Error ? err.message : "Forecast request failed",
      }));
    }
  }, [hostId, metricId, timeframe, forecastHorizon, queryInterval, spikeMultiplier]);

  useEffect(() => {
    void runForecast();
  }, [runForecast]);

  return { ...result, refetch: runForecast };
}
