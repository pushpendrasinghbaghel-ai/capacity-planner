// ============================================================
// Forecast Accuracy Page — Track prediction vs actual
// ============================================================

import React, { useState, useMemo, useCallback } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { TitleBar } from "@dynatrace/strato-components-preview/layouts";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { EmptyState } from "@dynatrace/strato-components/content";
import { ProgressBar } from "@dynatrace/strato-components/content";
import { Button } from "@dynatrace/strato-components/buttons";
import { Text } from "@dynatrace/strato-components/typography";
import { Heading } from "@dynatrace/strato-components/typography";
import { Surface } from "@dynatrace/strato-components/layouts";
import { SuccessIcon, WarningIcon, CriticalIcon, RefreshIcon } from "@dynatrace/strato-icons";
import { useForecastSnapshots } from "../hooks/useForecastSnapshots";
import { formatDateTime, formatPercent, formatNumber } from "../utils/formatting";
import { CssTokens } from "../utils/design-tokens";
import type { ForecastSnapshot } from "../types";

interface SnapshotRow extends ForecastSnapshot {
  status: "pending" | "accurate" | "inaccurate";
}

export const ForecastAccuracy: React.FC = () => {
  const {
    snapshots,
    isLoading,
    error,
    overallAccuracyPct,
    withinBandRate,
    refresh,
  } = useForecastSnapshots();

  const rows: SnapshotRow[] = useMemo(
    () =>
      snapshots.map((s) => ({
        ...s,
        status:
          s.actualValue === null
            ? "pending"
            : (s.accuracyPct ?? 0) >= 80
              ? "accurate"
              : "inaccurate",
      })),
    [snapshots],
  );

  const resolvedCount = snapshots.filter((s) => s.actualValue !== null).length;
  const pendingCount = snapshots.length - resolvedCount;

  const columns: DataTableColumnDef<SnapshotRow>[] = useMemo(
    () => [
      {
        id: "status",
        header: "Status",
        accessor: "status",
        cell: ({ value }) => {
          if (value === "pending") return <WarningIcon style={{ color: CssTokens.feedbackWarning }} />;
          if (value === "accurate") return <SuccessIcon style={{ color: CssTokens.feedbackSuccess }} />;
          return <CriticalIcon style={{ color: CssTokens.feedbackCritical }} />;
        },
      },
      {
        id: "hostName",
        header: "Host",
        accessor: "hostName",
      },
      {
        id: "metricLabel",
        header: "Metric",
        accessor: "metricLabel",
      },
      {
        id: "createdAt",
        header: "Predicted On",
        accessor: "createdAt",
        cell: ({ value }) => <Text>{formatDateTime(value)}</Text>,
      },
      {
        id: "targetDate",
        header: "Target Date",
        accessor: "targetDate",
        cell: ({ value }) => <Text>{formatDateTime(value)}</Text>,
      },
      {
        id: "forecastHorizonDays",
        header: "Horizon",
        accessor: "forecastHorizonDays",
        cell: ({ value }) => <Text>{value}d</Text>,
      },
      {
        id: "predictedValue",
        header: "Predicted",
        accessor: "predictedValue",
        cell: ({ value }) => <Text>{formatNumber(value, { maximumFractionDigits: 1 })}%</Text>,
      },
      {
        id: "band",
        header: "Confidence Band",
        accessor: (row) => `${formatNumber(row.predictedLower, { maximumFractionDigits: 1 })} – ${formatNumber(row.predictedUpper, { maximumFractionDigits: 1 })}%`,
      },
      {
        id: "actualValue",
        header: "Actual",
        accessor: "actualValue",
        cell: ({ value }) =>
          value !== null ? (
            <Text>{formatNumber(value, { maximumFractionDigits: 1 })}%</Text>
          ) : (
            <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>—</Text>
          ),
      },
      {
        id: "accuracyPct",
        header: "Accuracy",
        accessor: "accuracyPct",
        cell: ({ value }) => {
          if (value === null) return <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>—</Text>;
          const color =
            value >= 90
              ? "success"
              : value >= 70
                ? "warning"
                : "critical";
          return (
            <Flex flexDirection="row" alignItems="center" gap={4}>
              <ProgressBar value={value} max={100} color={color} density="condensed">
                <ProgressBar.Label>{formatNumber(value, { maximumFractionDigits: 1 })}%</ProgressBar.Label>
              </ProgressBar>
            </Flex>
          );
        },
      },
      {
        id: "withinBand",
        header: "In Band",
        accessor: "withinBand",
        cell: ({ value }) => {
          if (value === null) return <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>—</Text>;
          return value ? (
            <SuccessIcon style={{ color: CssTokens.feedbackSuccess }} />
          ) : (
            <CriticalIcon style={{ color: CssTokens.feedbackCritical }} />
          );
        },
      },
    ],
    [],
  );

  if (!isLoading && snapshots.length === 0) {
    return (
      <Flex flexDirection="column" gap={16} padding={16}>
        <TitleBar>
          <TitleBar.Title>Forecast Accuracy</TitleBar.Title>
        </TitleBar>
        <EmptyState>
          <EmptyState.Title>No forecast snapshots saved yet</EmptyState.Title>
          <EmptyState.Details>
            Save forecast predictions from the Fleet Overview page to start tracking accuracy over time.
          </EmptyState.Details>
        </EmptyState>
      </Flex>
    );
  }

  return (
    <Flex flexDirection="column" gap={16} padding={16}>
      <TitleBar>
        <TitleBar.Title>
          Forecast Accuracy {snapshots.length > 0 && `(${snapshots.length})`}
        </TitleBar.Title>
        <TitleBar.Subtitle>
          Compare predicted vs actual values to track forecast reliability
        </TitleBar.Subtitle>
        <TitleBar.Suffix>
          <Button variant="emphasized" onClick={refresh}>
            <Button.Prefix><RefreshIcon /></Button.Prefix>
            Refresh
          </Button>
        </TitleBar.Suffix>
      </TitleBar>

      {/* KPI Summary Cards */}
      <Flex flexDirection="row" gap={16}>
        <Surface style={{ flex: 1, padding: 16 }}>
          <Heading level={5}>{formatNumber(overallAccuracyPct ?? 0, { maximumFractionDigits: 1 })}%</Heading>
          <Text textStyle="small">Forecast Accuracy Rate</Text>
        </Surface>
        <Surface style={{ flex: 1, padding: 16 }}>
          <Heading level={5}>{formatNumber(withinBandRate ?? 0, { maximumFractionDigits: 1 })}%</Heading>
          <Text textStyle="small">Within Confidence Band</Text>
        </Surface>
        <Surface style={{ flex: 1, padding: 16 }}>
          <Heading level={5}>{resolvedCount}</Heading>
          <Text textStyle="small">Resolved Predictions</Text>
        </Surface>
        <Surface style={{ flex: 1, padding: 16 }}>
          <Heading level={5}>{pendingCount}</Heading>
          <Text textStyle="small">Pending Predictions</Text>
        </Surface>
      </Flex>

      {/* Snapshot Table */}
      <DataTable
        data={rows}
        columns={columns}
        sortable
        resizable
        loading={isLoading}
      >
        <DataTable.Toolbar>
          <DataTable.DownloadData />
        </DataTable.Toolbar>
      </DataTable>
    </Flex>
  );
};
