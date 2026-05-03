import React, { useMemo } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Paragraph } from "@dynatrace/strato-components/typography";
import {
  TimeseriesChart,
} from "@dynatrace/strato-components-preview/charts";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import type { ForecastResult } from "../hooks/useForecast";
import type { TimeseriesBand, TimeseriesBandDataPoint } from "@dynatrace/strato-components/charts";

type ForecastChartProps = {
  forecast: ForecastResult;
  metricLabel: string;
};

export const ForecastChart = ({ forecast, metricLabel }: ForecastChartProps) => {
  const { historical, forecastPoint, forecastUpper, forecastLower, timeframe, interval, historicalTimeframe, historicalInterval, status, error } = forecast;

  // Build line series: historical + forecast midline
  const lineSeries = useMemo(() => {
    if (status !== "success" || !timeframe.start) return null;

    const forecastStartMs = new Date(timeframe.start).getTime();
    const histStartMs = historicalTimeframe?.start
      ? new Date(historicalTimeframe.start).getTime()
      : forecastStartMs;
    const histIntervalMs = historicalInterval || interval;

    const toDatapoints = (values: number[], baseMs: number, stepMs: number) =>
      values
        .map((v, i) => ({
          start: new Date(baseMs + i * stepMs),
          value: v,
        }))
        .filter((dp) => dp.value != null);

    return [
      { name: `${metricLabel} (Current)`, datapoints: toDatapoints(historical, histStartMs, histIntervalMs) },
      { name: `${metricLabel} (Forecast)`, datapoints: toDatapoints(forecastPoint, forecastStartMs, interval) },
    ].filter((s) => s.datapoints.length > 0);
  }, [historical, forecastPoint, timeframe, interval, historicalTimeframe, historicalInterval, status, metricLabel]);

  // Build confidence band from upper/lower bounds
  const bandData = useMemo((): TimeseriesBand | null => {
    if (status !== "success" || !timeframe.start) return null;
    if (forecastUpper.length === 0 || forecastLower.length === 0) return null;

    const forecastStartMs = new Date(timeframe.start).getTime();
    const len = Math.min(forecastUpper.length, forecastLower.length);
    const datapoints: TimeseriesBandDataPoint[] = [];
    for (let i = 0; i < len; i++) {
      const lo = forecastLower[i];
      const hi = forecastUpper[i];
      if (lo == null || hi == null) continue;
      datapoints.push({
        y0: lo,
        y1: hi,
        start: new Date(forecastStartMs + i * interval),
      });
    }
    if (datapoints.length === 0) return null;
    return { name: "Confidence Interval", datapoints };
  }, [forecastUpper, forecastLower, timeframe, interval, status]);

  // Compute full time range across all series (must be before early returns — rules of hooks)
  const xRange = useMemo(() => {
    if (!lineSeries || lineSeries.length === 0) return undefined;
    let min = Infinity;
    let max = -Infinity;
    for (const s of lineSeries) {
      for (const dp of s.datapoints) {
        const t = dp.start.getTime();
        if (t < min) min = t;
        if (t > max) max = t;
      }
    }
    if (bandData) {
      for (const dp of bandData.datapoints) {
        const t = dp.start.getTime();
        if (t < min) min = t;
        if (t > max) max = t;
      }
    }
    if (min === Infinity || max === -Infinity) return undefined;
    return { min, max };
  }, [lineSeries, bandData]);

  if (status === "idle") {
    return <Paragraph>Select a host to view forecast.</Paragraph>;
  }

  if (status === "loading") {
    return (
      <Flex alignItems="center" gap={8} padding={32}>
        <ProgressCircle />
        <Paragraph>Running Davis forecast…</Paragraph>
      </Flex>
    );
  }

  if (status === "error") {
    return <Paragraph>Forecast error: {error}</Paragraph>;
  }

  if (!lineSeries || lineSeries.length === 0) {
    return <Paragraph>No data available.</Paragraph>;
  }

  return (
    <Flex flexDirection="column" style={{ height: 350 }}>
      <TimeseriesChart data={lineSeries} variant="line" gapPolicy="connect">
        {xRange && <TimeseriesChart.XAxis min={xRange.min} max={xRange.max} />}
        <TimeseriesChart.YAxis min={0} max={100} label="%" />
        {bandData && <TimeseriesChart.Band data={bandData} />}
      </TimeseriesChart>
    </Flex>
  );
};
