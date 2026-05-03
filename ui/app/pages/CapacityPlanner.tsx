import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Flex, Surface, TitleBar } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { Select } from "@dynatrace/strato-components/forms";
import { ProgressCircle, EmptyState } from "@dynatrace/strato-components/content";
import { Button } from "@dynatrace/strato-components/buttons";
import { TimeframeSelector } from "@dynatrace/strato-components/filters";
import { RefreshIcon } from "@dynatrace/strato-icons";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { ForecastChart } from "../components/ForecastChart";
import { Recommendation } from "../components/Recommendation";
import { useForecast, METRICS } from "../hooks/useForecast";
import { useGlobalFilters, createDefaultTimeframe } from "../context/FilterContext";
import { CssTokens } from "../utils/design-tokens";
import { formatPercent } from "../utils/formatting";
import type { Timeframe } from "@dynatrace/strato-components/core";

export const CapacityPlanner = () => {
  const [searchParams] = useSearchParams();
  const { filters, updateFilter } = useGlobalFilters();
  const [hostId, setHostId] = useState<string | null>(searchParams.get("host"));
  const [hostName, setHostName] = useState<string>(searchParams.get("name") ?? "");

  // If URL params change, update state
  useEffect(() => {
    const urlHost = searchParams.get("host");
    const urlName = searchParams.get("name");
    if (urlHost && urlHost !== hostId) {
      setHostId(urlHost);
      setHostName(urlName ?? urlHost);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const cpuForecast = useForecast(hostId, "cpu", filters.timeframe);
  const memForecast = useForecast(hostId, "memory", filters.timeframe);
  const diskForecast = useForecast(hostId, "disk", filters.timeframe);

  // Fetch available hosts
  const { data: hostData, isLoading: hostsLoading } = useDql({
    query: `smartscapeNodes "HOST"
| fields sid = id, name
| fieldsAdd id = toString(sid)
| fields id, name
| sort name asc
| limit 200`,
  });

  const hosts = useMemo(() => {
    if (!hostData?.records) return [];
    return hostData.records.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      name: (r["name"] as string) ?? (r.id as string),
    }));
  }, [hostData]);

  const handleHostChange = useCallback(
    (value: string | string[] | null) => {
      const id = typeof value === "string" ? value : value?.[0] ?? null;
      if (id) {
        setHostId(id);
        const host = hosts.find((h) => h.id === id);
        setHostName(host?.name ?? id);
      }
    },
    [hosts]
  );

  const handleRefresh = useCallback(() => {
    cpuForecast.refetch();
    memForecast.refetch();
    diskForecast.refetch();
  }, [cpuForecast, memForecast, diskForecast]);

  // Current utilization summary
  const currentCpu = cpuForecast.status === "success" && cpuForecast.historical.length > 0
    ? cpuForecast.historical[cpuForecast.historical.length - 1]
    : null;
  const currentMem = memForecast.status === "success" && memForecast.historical.length > 0
    ? memForecast.historical[memForecast.historical.length - 1]
    : null;
  const currentDisk = diskForecast.status === "success" && diskForecast.historical.length > 0
    ? diskForecast.historical[diskForecast.historical.length - 1]
    : null;

  const isAnyLoading = cpuForecast.status === "loading" || memForecast.status === "loading" || diskForecast.status === "loading";

  const handleTimeframeChange = useCallback((tf: Timeframe | null) => {
    updateFilter("timeframe", tf ?? createDefaultTimeframe());
  }, [updateFilter]);

  return (
    <Flex flexDirection="column" gap={0} style={{ height: "100%" }}>
      {/* ── TitleBar ── */}
      <TitleBar>
        <TitleBar.Title>
          Host Forecast {hostName && (
            <Text style={{ color: CssTokens.textSecondary, fontWeight: 400 }}>— {hostName}</Text>
          )}
        </TitleBar.Title>
        <TitleBar.Subtitle>
          Davis AI forecast for CPU, memory, and disk capacity
        </TitleBar.Subtitle>
        <TitleBar.Suffix>
          <Flex alignItems="center" gap={8}>
            <TimeframeSelector value={filters.timeframe} onChange={handleTimeframeChange} />
            <Button variant="default" onClick={handleRefresh} disabled={isAnyLoading}>
              <Button.Prefix><RefreshIcon /></Button.Prefix>
              Refresh
            </Button>
          </Flex>
        </TitleBar.Suffix>
      </TitleBar>

      <Flex flexDirection="column" padding={16} gap={24}>
        {/* Host Selector */}
        <Surface>
          <Flex padding={16} alignItems="center" gap={16}>
            <Text style={{ fontWeight: 600, whiteSpace: "nowrap" }}>Host:</Text>
            {hostsLoading ? (
              <Flex alignItems="center" gap={8}>
                <ProgressCircle size="small" />
                <Text>Loading hosts…</Text>
              </Flex>
            ) : (
              <Select value={hostId} onChange={handleHostChange}>
                <Select.Trigger placeholder="Select a host to forecast…" style={{ minWidth: 400 }} />
                <Select.Content>
                  {hosts.map((h) => (
                    <Select.Option key={h.id} value={h.id}>
                      {h.name}
                    </Select.Option>
                  ))}
                </Select.Content>
              </Select>
            )}
          </Flex>
        </Surface>

        {/* Recommendation Cards */}
        {hostId && (
          <Flex gap={16} flexWrap="wrap">
            <Recommendation forecast={cpuForecast} metricLabel={METRICS.cpu.label} />
            <Recommendation forecast={memForecast} metricLabel={METRICS.memory.label} />
            <Recommendation forecast={diskForecast} metricLabel={METRICS.disk.label} />
          </Flex>
        )}

        {/* Current Utilization Summary */}
        {hostId && currentCpu !== null && (
          <Surface>
            <Flex padding={16} gap={32} alignItems="center">
              <Text style={{ fontWeight: 600 }}>Current Utilization:</Text>
              <Flex gap={24}>
                <Text>CPU: <strong>{formatPercent(currentCpu)}</strong></Text>
                <Text>Memory: <strong>{currentMem !== null ? formatPercent(currentMem) : "—"}</strong></Text>
                <Text>Disk: <strong>{currentDisk !== null ? formatPercent(currentDisk) : "—"}</strong></Text>
              </Flex>
            </Flex>
          </Surface>
        )}

        {/* Forecast Charts */}
        {hostId && (
          <Surface>
            <Flex flexDirection="column" padding={16} gap={8}>
              <Tabs defaultIndex={0}>
                <Tab title="CPU">
                  <ForecastChart forecast={cpuForecast} metricLabel={METRICS.cpu.label} />
                </Tab>
                <Tab title="Memory">
                  <ForecastChart forecast={memForecast} metricLabel={METRICS.memory.label} />
                </Tab>
                <Tab title="Disk">
                  <ForecastChart forecast={diskForecast} metricLabel={METRICS.disk.label} />
                </Tab>
              </Tabs>
            </Flex>
          </Surface>
        )}

        {/* Empty state */}
        {!hostId && (
          <EmptyState>
            <EmptyState.Title>Select a host to begin</EmptyState.Title>
            <EmptyState.Details>
              Choose a host from the dropdown above. Davis AI will forecast CPU, memory,
              and disk usage for the next 48 hours with confidence intervals.
            </EmptyState.Details>
          </EmptyState>
        )}
      </Flex>
    </Flex>
  );
};
