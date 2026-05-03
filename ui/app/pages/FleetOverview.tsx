// ============================================================
// Fleet Overview — Dynatrace standard app structure
// TitleBar + FilterField + TimeframeSelector + Tabs + DataTable
// Pattern: https://developer.dynatrace.com/design/patterns/app-structure/
// Filter: https://developer.dynatrace.com/design/patterns/filtering/
// ============================================================

import React, { useState, useMemo, useCallback } from "react";
import { Flex, Surface, TitleBar } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { ProgressBar, EmptyState } from "@dynatrace/strato-components/content";
import { FilterField, TimeframeSelector, SegmentSelector } from "@dynatrace/strato-components/filters";
import { Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import type { Timeframe } from "@dynatrace/strato-components/core";
import {
  CriticalIcon,
  WarningIcon,
  SuccessIcon,
  CheckmarkIcon,
  RefreshIcon,
} from "@dynatrace/strato-icons";
import { useFleetHealth, type HostHealthRow } from "../hooks/useFleetHealth";
import { HostDetailSheet } from "../components/HostDetailSheet";
import { useGlobalFilters, getTimeframeDqlClause, createDefaultTimeframe } from "../context/FilterContext";
import { CssTokens } from "../utils/design-tokens";
import { formatPercent } from "../utils/formatting";
import type { BottleneckSeverity } from "../types";

// ---- Severity display config ----
const SEV: Record<BottleneckSeverity, { icon: React.ReactNode; color: string; label: string }> = {
  critical: { icon: <CriticalIcon />, color: CssTokens.feedbackCritical, label: "Critical" },
  warning: { icon: <WarningIcon />, color: CssTokens.feedbackWarning, label: "Warning" },
  healthy: { icon: <SuccessIcon />, color: CssTokens.feedbackSuccess, label: "Healthy" },
  over_provisioned: { icon: <CheckmarkIcon />, color: CssTokens.feedbackInfo, label: "Over-provisioned" },
};

// ---- Utilization bar ----
const UtilBar: React.FC<{ value: number | null }> = ({ value }) => {
  if (value == null) return <Text style={{ color: CssTokens.textSecondary }}>—</Text>;
  const color = value >= 85 ? "critical" : value >= 70 ? "warning" : "primary";
  return (
    <Flex alignItems="center" gap={8} style={{ minWidth: 120 }}>
      <ProgressBar value={value} max={100} color={color} density="condensed" style={{ flex: 1 }}>
        <ProgressBar.Label>{formatPercent(value)}</ProgressBar.Label>
      </ProgressBar>
    </Flex>
  );
};

// ---- FilterField key suggestions ----
const FILTER_SUGGESTIONS: Record<string, string[]> = {
  status: ["critical", "warning", "healthy", "over_provisioned"],
  bottleneck: ["CPU", "Memory", "Disk"],
  forecast: ["ready", "insufficient", "none"],
};

/** Parse FilterField text into structured filters.
 *  Supports: status == critical, bottleneck == CPU, forecast == ready
 *  and plain text for host name matching. */
function parseFilterText(text: string): { nameQuery: string; status?: string; bottleneck?: string; forecast?: string } {
  const result: { nameQuery: string; status?: string; bottleneck?: string; forecast?: string } = { nameQuery: "" };
  const parts: string[] = [];

  // Extract key==value pairs
  const kvRegex = /(\w+)\s*==\s*"?([^",\s]+)"?/gi;
  let match: RegExpExecArray | null;
  const consumed = new Set<number>();

  while ((match = kvRegex.exec(text)) !== null) {
    const key = match[1].toLowerCase();
    const val = match[2];
    if (key === "status") result.status = val;
    else if (key === "bottleneck") result.bottleneck = val;
    else if (key === "forecast") result.forecast = val;
    consumed.add(match.index);
    for (let i = 1; i < match[0].length; i++) consumed.add(match.index + i);
  }

  // Remaining text → name filter
  const remaining = text.replace(kvRegex, "").trim();
  if (remaining) result.nameQuery = remaining.toLowerCase();

  return result;
}

// ---- Main Component ----
export const FleetOverview = () => {
  const { filters, updateFilter } = useGlobalFilters();
  const timeframeDql = useMemo(() => getTimeframeDqlClause(filters.timeframe), [filters.timeframe]);
  const { hosts, status, error, reload, summary } = useFleetHealth(timeframeDql);

  // Sheet state
  const [selectedHost, setSelectedHost] = useState<HostHealthRow | null>(null);
  const [showSheet, setShowSheet] = useState(false);

  // FilterField text state
  const [filterText, setFilterText] = useState("");

  const handleTimeframeChange = useCallback((tf: Timeframe | null) => {
    updateFilter("timeframe", tf ?? createDefaultTimeframe());
  }, [updateFilter]);

  const handleHostClick = useCallback((activeRowId: string | null) => {
    if (!activeRowId) return;
    const host = hosts.find((h) => h.id === activeRowId);
    if (host) {
      setSelectedHost(host);
      setShowSheet(true);
    }
  }, [hosts]);

  const handleSheetDismiss = useCallback(() => {
    setShowSheet(false);
  }, []);

  const handleFilterChange = useCallback((value: string) => {
    setFilterText(value);
  }, []);

  const isLoading = status === "loading";

  // Apply FilterField text to host list
  const filteredHosts = useMemo(() => {
    if (!filterText.trim()) return hosts;

    const parsed = parseFilterText(filterText);
    let result = hosts;

    // Name text search
    if (parsed.nameQuery) {
      result = result.filter((h) => h.name.toLowerCase().includes(parsed.nameQuery));
    }

    // Structured filters
    if (parsed.status) {
      result = result.filter((h) => h.severity === parsed.status);
    }
    if (parsed.bottleneck) {
      result = result.filter((h) => h.constraintMetric === parsed.bottleneck);
    }
    if (parsed.forecast === "ready") {
      result = result.filter((h) => h.forecastReady);
    } else if (parsed.forecast === "insufficient") {
      result = result.filter((h) => !h.forecastReady && h.dataPoints > 0);
    } else if (parsed.forecast === "none") {
      result = result.filter((h) => h.dataPoints === 0);
    }

    return result;
  }, [hosts, filterText]);

  // ---- Column definitions: Health tab ----
  const healthColumns = useMemo((): DataTableColumnDef<HostHealthRow>[] => [
    {
      id: "severity",
      header: "",
      accessor: "severity",
      width: 36,
      cell: ({ rowData }) => {
        const cfg = SEV[rowData.severity];
        return <span style={{ color: cfg.color }}>{cfg.icon}</span>;
      },
    },
    {
      id: "name",
      header: "Host",
      accessor: "name",
      cell: ({ value }) => <Text style={{ fontWeight: 500 }}>{value as string}</Text>,
    },
    {
      id: "status",
      header: "Status",
      accessor: "severity",
      width: 130,
      cell: ({ rowData }) => {
        const cfg = SEV[rowData.severity];
        return (
          <Flex alignItems="center" gap={4}>
            <span style={{ color: cfg.color, display: "flex" }}>{cfg.icon}</span>
            <Text textStyle="small-emphasized" style={{ color: cfg.color }}>{cfg.label}</Text>
          </Flex>
        );
      },
    },
    {
      id: "constraintMetric",
      header: "Bottleneck",
      accessor: "constraintMetric",
      width: 100,
      cell: ({ value, rowData }) => (
        <Text textStyle="small-emphasized" style={{ color: SEV[rowData.severity].color }}>
          {value as string}
        </Text>
      ),
    },
    {
      id: "cpuAvg",
      header: "CPU %",
      accessor: "cpuAvg",
      width: 80,
      cell: ({ value }) => {
        const v = value as number | null;
        if (v == null) return <Text style={{ color: CssTokens.textSecondary }}>—</Text>;
        const c = v >= 85 ? CssTokens.feedbackCritical : v >= 70 ? CssTokens.feedbackWarning : CssTokens.textPrimary;
        return <Text textStyle="small-emphasized" style={{ color: c }}>{formatPercent(v)}</Text>;
      },
    },
    {
      id: "memoryAvg",
      header: "Mem %",
      accessor: "memoryAvg",
      width: 80,
      cell: ({ value }) => {
        const v = value as number | null;
        if (v == null) return <Text style={{ color: CssTokens.textSecondary }}>—</Text>;
        const c = v >= 85 ? CssTokens.feedbackCritical : v >= 70 ? CssTokens.feedbackWarning : CssTokens.textPrimary;
        return <Text textStyle="small-emphasized" style={{ color: c }}>{formatPercent(v)}</Text>;
      },
    },
    {
      id: "diskUsedPct",
      header: "Disk %",
      accessor: "diskUsedPct",
      width: 80,
      cell: ({ value }) => {
        const v = value as number | null;
        if (v == null) return <Text style={{ color: CssTokens.textSecondary }}>—</Text>;
        const c = v >= 85 ? CssTokens.feedbackCritical : v >= 70 ? CssTokens.feedbackWarning : CssTokens.textPrimary;
        return <Text textStyle="small-emphasized" style={{ color: c }}>{formatPercent(v)}</Text>;
      },
    },
    {
      id: "forecastReady",
      header: "Forecast",
      accessor: "forecastReady",
      width: 100,
      cell: ({ rowData }) => {
        if (rowData.forecastReady) {
          return (
            <Flex alignItems="center" gap={4}>
              <CheckmarkIcon style={{ color: CssTokens.feedbackSuccess }} />
              <Text textStyle="small-emphasized" style={{ color: CssTokens.feedbackSuccess }}>Ready ({rowData.dataPoints}pts)</Text>
            </Flex>
          );
        }
        if (rowData.dataPoints > 0) {
          return (
            <Flex alignItems="center" gap={4}>
              <WarningIcon style={{ color: CssTokens.feedbackWarning }} />
              <Text textStyle="small-emphasized" style={{ color: CssTokens.feedbackWarning }}>{rowData.dataPoints}pts</Text>
            </Flex>
          );
        }
        return <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>— No data</Text>;
      },
    },
  ], []);

  // ---- Column definitions: Utilization tab ----
  const utilizationColumns = useMemo((): DataTableColumnDef<HostHealthRow>[] => [
    {
      id: "name",
      header: "Host",
      accessor: "name",
      cell: ({ value }) => <Text style={{ fontWeight: 500 }}>{value as string}</Text>,
    },
    {
      id: "cpuAvg",
      header: "CPU",
      accessor: "cpuAvg",
      width: 200,
      cell: ({ value }) => <UtilBar value={value as number | null} />,
    },
    {
      id: "memoryAvg",
      header: "Memory",
      accessor: "memoryAvg",
      width: 200,
      cell: ({ value }) => <UtilBar value={value as number | null} />,
    },
    {
      id: "diskUsedPct",
      header: "Disk",
      accessor: "diskUsedPct",
      width: 200,
      cell: ({ value }) => <UtilBar value={value as number | null} />,
    },
    {
      id: "severity",
      header: "Status",
      accessor: "severity",
      width: 120,
      cell: ({ rowData }) => {
        const cfg = SEV[rowData.severity];
        return (
          <Flex alignItems="center" gap={4}>
            <span style={{ color: cfg.color, display: "flex" }}>{cfg.icon}</span>
            <Text textStyle="small" style={{ color: cfg.color }}>{cfg.label}</Text>
          </Flex>
        );
      },
    },
  ], []);

  // ---- Host table component (shared by both tabs) ----
  const HostTable: React.FC<{ columns: DataTableColumnDef<HostHealthRow>[] }> = ({ columns }) => {
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

    if (!isLoading && filteredHosts.length === 0) {
      return (
        <EmptyState>
          <EmptyState.Title>No hosts found</EmptyState.Title>
          <EmptyState.Details>
            No results found. Try adjusting your filter or expanding the timeframe.
          </EmptyState.Details>
        </EmptyState>
      );
    }

    return (
      <DataTable
        data={filteredHosts}
        columns={columns}
        sortable
        resizable
        fullWidth
        columnOrdering
        loading={isLoading}
        rowId={(row) => row.id}
        interactiveRows
        onActiveRowChange={handleHostClick}
      >
        <DataTable.Toolbar>
          <DataTable.LineWrap />
          <DataTable.ColumnOrderSettings />
          <DataTable.DownloadData />
        </DataTable.Toolbar>
        <DataTable.Pagination defaultPageSize={25} />
      </DataTable>
    );
  };

  return (
    <Flex flexDirection="column" gap={0} style={{ height: "100%" }}>
      {/* ── TitleBar: page title + count ── */}
      <TitleBar>
        <TitleBar.Title>
          Hosts {!isLoading && status === "success" && (
            <Text style={{ color: CssTokens.textSecondary, fontWeight: 400 }}>
              {filteredHosts.length}{filteredHosts.length !== hosts.length ? ` of ${hosts.length}` : ""}
            </Text>
          )}
        </TitleBar.Title>
      </TitleBar>

      {/* ── Filter row: SegmentSelector → FilterField → TimeframeSelector → Refresh ── */}
      <Flex padding={16} paddingTop={0} paddingBottom={8} alignItems="center" gap={8}>
        <SegmentSelector />
        <FilterField
          placeholder="Type to filter"
          value={filterText}
          onChange={handleFilterChange}
          style={{ flex: 1 }}
        />
        <TimeframeSelector value={filters.timeframe} onChange={handleTimeframeChange} />
        <Button variant="default" onClick={reload} disabled={isLoading}>
          <Button.Prefix><RefreshIcon /></Button.Prefix>
          Refresh
        </Button>
      </Flex>

      {/* ── Tabs: Health / Utilization ── */}
      <Flex flexDirection="column" paddingLeft={16} paddingRight={16} paddingBottom={16} style={{ flex: 1, minHeight: 0 }}>
        <Tabs>
          <Tab title="Health">
            <HostTable columns={healthColumns} />
          </Tab>
          <Tab title="Utilization">
            <HostTable columns={utilizationColumns} />
          </Tab>
        </Tabs>
      </Flex>

      {/* ── Host Detail Sheet ── */}
      <HostDetailSheet
        host={selectedHost}
        show={showSheet}
        onDismiss={handleSheetDismiss}
        timeframe={filters.timeframe}
      />
    </Flex>
  );
};
