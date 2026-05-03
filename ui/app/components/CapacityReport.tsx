// ============================================================
// CapacityReport — Multi-horizon Davis AI capacity forecast report
// Select node from topology → generate 3/6/9/12 month projections
// ============================================================

import React, { useMemo } from "react";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import { Button } from "@dynatrace/strato-components/buttons";
import {
  CriticalIcon,
  WarningIcon,
  SuccessIcon,
  CheckmarkIcon,
} from "@dynatrace/strato-icons";
import { CssTokens } from "../utils/design-tokens";
import { formatPercent, formatDateTime } from "../utils/formatting";
import type { BottleneckSeverity } from "../types";
import type { CapacityReportData, HorizonForecast } from "../hooks/useCapacityReport";

const SEVERITY_BADGE: Record<BottleneckSeverity, { icon: React.ReactNode; color: string; label: string }> = {
  critical: { icon: <CriticalIcon />, color: CssTokens.feedbackCritical, label: "CRITICAL" },
  warning: { icon: <WarningIcon />, color: CssTokens.feedbackWarning, label: "WARNING" },
  healthy: { icon: <SuccessIcon />, color: CssTokens.feedbackSuccess, label: "HEALTHY" },
  over_provisioned: { icon: <CheckmarkIcon />, color: CssTokens.feedbackInfo, label: "OVER-PROVISIONED" },
};

interface CapacityReportProps {
  report: CapacityReportData | null;
  status: "idle" | "loading" | "success" | "error";
  error: string | null;
  onBack: () => void;
}

// Flat row for the combined table
interface ReportRow {
  id: string;
  horizon: string;
  metric: string;
  currentValue: number;
  forecastedValue: number;
  upperBound: number;
  headroomPct: number;
  severity: BottleneckSeverity;
}

export const CapacityReport: React.FC<CapacityReportProps> = ({ report, status, error, onBack }) => {
  // Flatten horizons × metrics into rows for the table
  const rows: ReportRow[] = useMemo(() => {
    if (!report) return [];
    const result: ReportRow[] = [];
    for (const h of report.horizons) {
      for (const m of h.metrics) {
        result.push({
          id: `${h.horizonKey}-${m.metricKey}`,
          horizon: h.horizonLabel,
          metric: m.metricLabel,
          currentValue: m.currentValue,
          forecastedValue: m.forecastedValue,
          upperBound: m.upperBound,
          headroomPct: m.headroomPct,
          severity: m.severity,
        });
      }
    }
    return result;
  }, [report]);

  const columns = useMemo((): DataTableColumnDef<ReportRow>[] => [
    {
      id: "severity",
      header: "",
      accessor: "severity",
      width: 40,
      cell: ({ value }) => {
        const cfg = SEVERITY_BADGE[value as BottleneckSeverity];
        return <span style={{ color: cfg.color }}>{cfg.icon}</span>;
      },
    },
    { id: "horizon", header: "Horizon", accessor: "horizon", width: 100 },
    { id: "metric", header: "Metric", accessor: "metric", width: 140 },
    {
      id: "currentValue",
      header: "Current",
      accessor: "currentValue",
      width: 90,
      cell: ({ value }) => <Text>{formatPercent(value as number)}</Text>,
    },
    {
      id: "forecastedValue",
      header: "Forecast",
      accessor: "forecastedValue",
      width: 90,
      cell: ({ value, rowData }) => {
        const sev = rowData.severity;
        return (
          <Text
            style={{
              fontWeight: 600,
              color:
                sev === "critical"
                  ? CssTokens.feedbackCritical
                  : sev === "warning"
                  ? CssTokens.feedbackWarning
                  : CssTokens.feedbackSuccess,
            }}
          >
            {formatPercent(value as number)}
          </Text>
        );
      },
    },
    {
      id: "upperBound",
      header: "Worst Case",
      accessor: "upperBound",
      width: 100,
      cell: ({ value, rowData }) => {
        const sev = rowData.severity;
        return (
          <Text style={{ color: sev === "critical" ? CssTokens.feedbackCritical : CssTokens.feedbackWarning }}>
            {formatPercent(value as number)}
          </Text>
        );
      },
    },
    {
      id: "headroomPct",
      header: "Headroom",
      accessor: "headroomPct",
      width: 90,
      cell: ({ value }) => {
        const v = value as number;
        return (
          <Text style={{ fontWeight: 600, color: v < 15 ? CssTokens.feedbackCritical : v < 30 ? CssTokens.feedbackWarning : CssTokens.feedbackSuccess }}>
            {formatPercent(v)}
          </Text>
        );
      },
    },
  ], []);

  if (status === "idle") {
    return (
      <Flex flexDirection="column" alignItems="center" justifyContent="center" padding={64} gap={16}>
        <Heading level={3}>Select a node from the topology</Heading>
        <Text style={{ color: CssTokens.textSecondary, textAlign: "center", maxWidth: 500 }}>
          Click on any HOST node in the topology graph above, then click "Generate Capacity Report"
          to produce a Davis AI-powered forecast for the next 3, 6, 9, and 12 months.
        </Text>
      </Flex>
    );
  }

  if (status === "loading") {
    return (
      <Flex alignItems="center" justifyContent="center" padding={64} gap={12}>
        <ProgressCircle />
        <Text>Davis AI is generating capacity forecasts for 4 horizons…</Text>
      </Flex>
    );
  }

  if (status === "error") {
    return (
      <Surface>
        <Flex padding={16} gap={8}>
          <CriticalIcon style={{ color: CssTokens.feedbackCritical }} />
          <Text style={{ color: CssTokens.feedbackCritical }}>{error}</Text>
        </Flex>
      </Surface>
    );
  }

  if (!report) return null;

  return (
    <Flex flexDirection="column" gap={24}>
      {/* Report header */}
      <Flex justifyContent="space-between" alignItems="center">
        <Flex flexDirection="column" gap={4}>
          <Heading level={2}>Capacity Report — {report.nodeName}</Heading>
          <Text style={{ color: CssTokens.textSecondary }}>
            {report.nodeType} • Generated {formatDateTime(report.generatedAt)} • Davis AI Forecast
          </Text>
        </Flex>
        <Button variant="default" onClick={onBack}>Back to Topology</Button>
      </Flex>

      {/* Horizon summary cards */}
      <Flex gap={16} flexWrap="wrap">
        {report.horizons.map((h) => (
          <HorizonCard key={h.horizonKey} horizon={h} />
        ))}
      </Flex>

      {/* Recommendations */}
      <Surface>
        <Flex flexDirection="column" padding={16} gap={12}>
          <Heading level={3}>Recommendations</Heading>
          {report.horizons.map((h) => (
            <Flex key={h.horizonKey} gap={8} alignItems="flex-start">
              <span style={{ color: SEVERITY_BADGE[h.overallSeverity].color, flexShrink: 0, marginTop: 2 }}>
                {SEVERITY_BADGE[h.overallSeverity].icon}
              </span>
              <Text textStyle="small">{h.recommendation}</Text>
            </Flex>
          ))}
        </Flex>
      </Surface>

      {/* Detailed forecast table */}
      <Surface>
        <Flex flexDirection="column" padding={16} gap={8}>
          <Heading level={3}>Detailed Forecast</Heading>
          <DataTable
            data={rows}
            columns={columns}
            fullWidth
            sortable
            resizable
            columnOrdering
          >
            <DataTable.Toolbar>
              <DataTable.LineWrap />
              <DataTable.ColumnOrderSettings />
              <DataTable.DownloadData />
            </DataTable.Toolbar>
          </DataTable>
        </Flex>
      </Surface>
    </Flex>
  );
};

// ---- Horizon summary card ----
const HorizonCard: React.FC<{ horizon: HorizonForecast }> = ({ horizon }) => {
  const badge = SEVERITY_BADGE[horizon.overallSeverity];
  const worstMetric = horizon.metrics.length > 0
    ? horizon.metrics.reduce((a, b) => (a.upperBound > b.upperBound ? a : b))
    : null;

  return (
    <Surface>
      <Flex
        flexDirection="column"
        padding={16}
        gap={8}
        style={{
          minWidth: 200,
          borderLeft: `4px solid ${badge.color}`,
        }}
      >
        <Flex justifyContent="space-between" alignItems="center">
          <Heading level={5}>{horizon.horizonLabel}</Heading>
          <Flex gap={4} alignItems="center">
            <span style={{ color: badge.color }}>{badge.icon}</span>
            <Text textStyle="small-emphasized" style={{ color: badge.color }}>{badge.label}</Text>
          </Flex>
        </Flex>
        {worstMetric && (
          <>
            <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>
              Bottleneck: {worstMetric.metricLabel}
            </Text>
            <Flex justifyContent="space-between">
              <Text textStyle="small">
                Now: <strong>{formatPercent(worstMetric.currentValue)}</strong>
              </Text>
              <Text textStyle="small" style={{ color: badge.color }}>
                Projected: <strong>{formatPercent(worstMetric.upperBound)}</strong>
              </Text>
            </Flex>
            <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>
              Headroom: {formatPercent(worstMetric.headroomPct)}
            </Text>
          </>
        )}
        {horizon.metrics.length === 0 && (
          <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>
            Insufficient data for forecast
          </Text>
        )}
      </Flex>
    </Surface>
  );
};
