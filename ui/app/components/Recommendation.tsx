import React from "react";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import {
  CriticalIcon,
  WarningIcon,
  SuccessIcon,
  CheckmarkIcon,
} from "@dynatrace/strato-icons";
import { CssTokens, StatusColors } from "../utils/design-tokens";
import { formatPercent } from "../utils/formatting";
import type { ForecastResult } from "../hooks/useForecast";

type RecommendationProps = {
  forecast: ForecastResult;
  metricLabel: string;
};

type Action = {
  action: string;
  color: string;
  cssColor: string;
  icon: React.ReactNode;
  description: string;
};

function getRecommendation(forecast: ForecastResult): Action {
  if (forecast.status !== "success") {
    return {
      action: "PENDING",
      color: StatusColors.neutral,
      cssColor: CssTokens.textSecondary,
      icon: null,
      description: "Waiting for forecast data…",
    };
  }

  const validHistorical = forecast.historical.filter((v) => v != null);
  const currentValue = validHistorical.length > 0 ? validHistorical[validHistorical.length - 1] : 0;

  const validUpper = forecast.forecastUpper.filter((v) => v != null);
  const forecastMax = validUpper.length > 0 ? Math.max(...validUpper) : 0;

  const validPoint = forecast.forecastPoint.filter((v) => v != null);
  const forecastAvg = validPoint.length > 0 ? validPoint.reduce((a, b) => a + b, 0) / validPoint.length : 0;

  if (forecastMax > 85) {
    return {
      action: "INCREASE CAPACITY",
      color: StatusColors.critical,
      cssColor: CssTokens.feedbackCritical,
      icon: <CriticalIcon />,
      description: `Forecast peak ${formatPercent(forecastMax)} exceeds 85% threshold. Scale up recommended.`,
    };
  }

  if (forecastMax > 70) {
    return {
      action: "MONITOR CLOSELY",
      color: StatusColors.warning,
      cssColor: CssTokens.feedbackWarning,
      icon: <WarningIcon />,
      description: `Forecast peak ${formatPercent(forecastMax)} approaching capacity. Monitor closely.`,
    };
  }

  if (currentValue < 30 && forecastAvg < 30) {
    return {
      action: "SCALE DOWN",
      color: StatusColors.good,
      cssColor: CssTokens.feedbackSuccess,
      icon: <SuccessIcon />,
      description: `Current ${formatPercent(currentValue)}, forecast avg ${formatPercent(forecastAvg)}. Over-provisioned — scale down.`,
    };
  }

  return {
    action: "STABLE",
    color: StatusColors.good,
    cssColor: CssTokens.feedbackSuccess,
    icon: <CheckmarkIcon />,
    description: `Current ${formatPercent(currentValue)}, forecast peak ${formatPercent(forecastMax)}. Capacity is healthy.`,
  };
}

export const Recommendation = ({ forecast, metricLabel }: RecommendationProps) => {
  const rec = getRecommendation(forecast);

  return (
    <Surface style={{ flex: "1 1 280px", minWidth: 280 }}>
      <Flex flexDirection="column" gap={8} padding={16}>
        <Flex alignItems="center" gap={8}>
          <span style={{ color: rec.cssColor }}>{rec.icon}</span>
          <Heading level={4}>
            {metricLabel}
          </Heading>
        </Flex>
        <Text
          style={{
            color: rec.cssColor,
            fontWeight: 600,
            fontSize: "var(--dt-sizes-font-size-300)",
          }}
        >
          {rec.action}
        </Text>
        <Text style={{ color: CssTokens.textSecondary }}>{rec.description}</Text>
      </Flex>
    </Surface>
  );
};
