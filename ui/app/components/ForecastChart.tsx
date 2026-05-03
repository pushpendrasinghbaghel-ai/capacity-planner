import React, { useMemo } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Paragraph } from "@dynatrace/strato-components/typography";
import {
  TimeseriesChart,
} from "@dynatrace/strato-components-preview/charts";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import type { ForecastResult } from "../hooks/useForecast";

type ForecastChartProps = {
  forecast: ForecastResult;
  metricLabel: string;
};

export const ForecastChart = ({ forecast, metricLabel }: ForecastChartProps) => {
  const { historical, forecastPoint, forecastUpper, forecastLower, timeframe, interval, status, error } = forecast;

  const chartData = useMemo(() => {
    if (status !== "success" || !timeframe.start) return null;

    const startMs = new Date(timeframe.start).getTime();
    // interval is already in milliseconds (normalized in useForecast)
    const intervalMs = interval;

    const toDatapoints = (values: number[]) =>
      values
        .map((v, i) => ({
          start: new Date(startMs + i * intervalMs),
          value: v,
        }))
        .filter((dp) => dp.value != null);

    return [
      { name: `${metricLabel} (Current)`, datapoints: toDatapoints(historical) },
      { name: `${metricLabel} (Forecast)`, datapoints: toDatapoints(forecastPoint) },
      { name: "Upper Bound", datapoints: toDatapoints(forecastUpper) },
      { name: "Lower Bound", datapoints: toDatapoints(forecastLower) },
    ].filter((s) => s.datapoints.length > 0);
  }, [historical, forecastPoint, forecastUpper, forecastLower, timeframe, interval, status, metricLabel]);

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

  if (!chartData || chartData.length === 0) {
    return <Paragraph>No data available.</Paragraph>;
  }

  return (
    <Flex flexDirection="column" style={{ height: 350 }}>
      <TimeseriesChart data={chartData} variant="line" gapPolicy="connect" />
    </Flex>
  );
};
