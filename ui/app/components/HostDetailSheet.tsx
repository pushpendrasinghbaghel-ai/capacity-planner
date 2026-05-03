// ============================================================
// HostDetailSheet — Full-width sheet overlay for host analysis
// Contains: forecast charts, AI analysis, what-if spike, neighbors
// ============================================================

import React, { useMemo } from "react";
import { Sheet } from "@dynatrace/strato-components-preview/overlays";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { Button } from "@dynatrace/strato-components/buttons";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import {
  CriticalIcon,
  WarningIcon,
  SuccessIcon,
  CheckmarkIcon,
  HostsIcon,
  ServicesIcon,
  ContainerIcon,
  ApplicationsIcon,
} from "@dynatrace/strato-icons";
import { ForecastChart } from "./ForecastChart";
import { useForecast, METRICS } from "../hooks/useForecast";
import { useHostNeighbors, type NeighborNode } from "../hooks/useHostNeighbors";
import type { HostHealthRow } from "../hooks/useFleetHealth";
import type { ForecastResult } from "../hooks/useForecast";
import { CssTokens } from "../utils/design-tokens";
import { formatPercent } from "../utils/formatting";
import type { Timeframe } from "@dynatrace/strato-components/core";

// ---- Types ----
interface HostDetailSheetProps {
  host: HostHealthRow | null;
  show: boolean;
  onDismiss: () => void;
  timeframe?: Timeframe | null;
}

// ---- AI Analysis Card ----
interface AnalysisCardProps {
  label: string;
  forecast: ForecastResult;
  spikeMultiplier: number;
}

function getAnalysisVerdict(forecast: ForecastResult, spikeMultiplier: number) {
  if (forecast.status !== "success") return null;

  const hist = forecast.historical.filter((v) => v != null);
  const pts = forecast.forecastPoint.filter((v) => v != null);
  const upper = forecast.forecastUpper.filter((v) => v != null);

  if (hist.length === 0) return null;

  const current = hist[hist.length - 1];
  const histAvg = hist.reduce((a, b) => a + b, 0) / hist.length;
  const histMax = Math.max(...hist);
  const trend = hist.length >= 2 ? hist[hist.length - 1] - hist[0] : 0;
  const trendPct = histAvg > 0 ? (trend / histAvg) * 100 : 0;

  const fcastAvg = pts.length > 0 ? pts.reduce((a, b) => a + b, 0) / pts.length : current;
  const fcastMax = upper.length > 0 ? Math.max(...upper) : fcastAvg;

  // What-if spike: apply multiplier to forecast
  const spikedMax = Math.min(fcastMax * spikeMultiplier, 100);
  const spikedAvg = Math.min(fcastAvg * spikeMultiplier, 100);

  return { current, histAvg, histMax, trend, trendPct, fcastAvg, fcastMax, spikedMax, spikedAvg };
}

const AnalysisCard: React.FC<AnalysisCardProps> = ({ label, forecast, spikeMultiplier }) => {
  const analysis = getAnalysisVerdict(forecast, spikeMultiplier);

  if (forecast.status === "loading") {
    return (
      <Surface style={{ flex: "1 1 300px" }}>
        <Flex padding={12} gap={8} alignItems="center">
          <ProgressCircle size="small" />
          <Text>{label}: Running forecast…</Text>
        </Flex>
      </Surface>
    );
  }

  if (forecast.status === "error") {
    return (
      <Surface style={{ flex: "1 1 300px" }}>
        <Flex padding={12} gap={6} alignItems="center">
          <CriticalIcon style={{ color: CssTokens.feedbackCritical }} />
          <Text textStyle="small" style={{ color: CssTokens.feedbackCritical }}>
            {label}: {forecast.error ?? "No data available for forecast"}
          </Text>
        </Flex>
      </Surface>
    );
  }

  if (!analysis) {
    return (
      <Surface style={{ flex: "1 1 300px" }}>
        <Flex padding={12}>
          <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>
            {label}: Insufficient data for analysis
          </Text>
        </Flex>
      </Surface>
    );
  }

  const { current, histAvg, trendPct, fcastMax, spikedMax } = analysis;

  // Determine action based on spike scenario
  const actionSeverity = spikedMax >= 85 ? "critical" : spikedMax >= 70 ? "warning" : spikedMax < 30 ? "over_provisioned" : "healthy";
  const actionIcon =
    actionSeverity === "critical" ? <CriticalIcon /> :
    actionSeverity === "warning" ? <WarningIcon /> :
    actionSeverity === "over_provisioned" ? <SuccessIcon /> :
    <CheckmarkIcon />;
  const actionColor =
    actionSeverity === "critical" ? CssTokens.feedbackCritical :
    actionSeverity === "warning" ? CssTokens.feedbackWarning :
    CssTokens.feedbackSuccess;
  const actionLabel =
    actionSeverity === "critical" ? "SCALE UP" :
    actionSeverity === "warning" ? "MONITOR" :
    actionSeverity === "over_provisioned" ? "RIGHTSIZE" :
    "STABLE";

  return (
    <Surface style={{ flex: "1 1 300px" }}>
      <Flex flexDirection="column" padding={12} gap={6}>
        <Flex alignItems="center" gap={6}>
          <span style={{ color: actionColor }}>{actionIcon}</span>
          <Text textStyle="base-emphasized">{label}</Text>
          <Text textStyle="small-emphasized" style={{ color: actionColor, marginLeft: "auto" }}>{actionLabel}</Text>
        </Flex>
        <Flex gap={16} flexWrap="wrap">
          <Flex flexDirection="column" gap={2}>
            <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>Current</Text>
            <Text textStyle="small-emphasized">{formatPercent(current)}</Text>
          </Flex>
          <Flex flexDirection="column" gap={2}>
            <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>Avg</Text>
            <Text textStyle="small-emphasized">{formatPercent(histAvg)}</Text>
          </Flex>
          <Flex flexDirection="column" gap={2}>
            <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>Trend</Text>
            <Text textStyle="small-emphasized" style={{ color: trendPct > 5 ? CssTokens.feedbackWarning : trendPct < -5 ? CssTokens.feedbackSuccess : CssTokens.textPrimary }}>
              {trendPct > 0 ? "+" : ""}{trendPct.toFixed(1)}%
            </Text>
          </Flex>
          <Flex flexDirection="column" gap={2}>
            <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>Forecast Peak</Text>
            <Text textStyle="small-emphasized">{formatPercent(fcastMax)}</Text>
          </Flex>
          {spikeMultiplier > 1 && (
            <Flex flexDirection="column" gap={2}>
              <Text textStyle="small" style={{ color: CssTokens.feedbackWarning }}>Spike {spikeMultiplier}x Peak</Text>
              <Text textStyle="small-emphasized" style={{ color: spikedMax >= 85 ? CssTokens.feedbackCritical : spikedMax >= 70 ? CssTokens.feedbackWarning : CssTokens.feedbackSuccess }}>
                {formatPercent(spikedMax)}
              </Text>
            </Flex>
          )}
        </Flex>
      </Flex>
    </Surface>
  );
};

// ---- Neighbor icon ----
function getNeighborIcon(type: string) {
  if (type === "HOST") return <HostsIcon />;
  if (type === "SERVICE") return <ServicesIcon />;
  if (type === "PROCESS" || type === "CONTAINER") return <ContainerIcon />;
  if (type === "FRONTEND") return <ApplicationsIcon />;
  return <ServicesIcon />;
}

const directionColors: Record<string, string> = {
  upstream: CssTokens.feedbackInfo,
  downstream: CssTokens.feedbackWarning,
  runs_on: CssTokens.feedbackSuccess,
};

// ---- Neighbor list ----
const NeighborList: React.FC<{ neighbors: NeighborNode[]; status: string; error: string | null }> = ({ neighbors, status, error }) => {
  if (status === "loading") {
    return (
      <Flex alignItems="center" gap={8} padding={12}>
        <ProgressCircle size="small" />
        <Text>Loading topology…</Text>
      </Flex>
    );
  }
  if (status === "error") return <Text style={{ color: CssTokens.feedbackCritical, padding: 12 }}>{error}</Text>;
  if (neighbors.length === 0) return <Text style={{ color: CssTokens.textSecondary, padding: 12 }}>No connected entities found.</Text>;

  const grouped = {
    upstream: neighbors.filter((n) => n.direction === "upstream"),
    runs_on: neighbors.filter((n) => n.direction === "runs_on"),
    downstream: neighbors.filter((n) => n.direction === "downstream"),
  };

  return (
    <Flex flexDirection="column" gap={8}>
      {(["upstream", "runs_on", "downstream"] as const).map((dir) => {
        const items = grouped[dir];
        if (items.length === 0) return null;
        const dirLabel = dir === "upstream" ? "Upstream (calls this host)" : dir === "runs_on" ? "Runs on this host" : "Downstream (called by this host)";
        return (
          <Flex key={dir} flexDirection="column" gap={4}>
            <Text textStyle="small-emphasized" style={{ color: directionColors[dir], textTransform: "uppercase", letterSpacing: 0.5 }}>
              {dirLabel} ({items.length})
            </Text>
            <Flex gap={6} flexWrap="wrap">
              {items.map((n) => (
                <Flex key={n.id} alignItems="center" gap={4} style={{
                  padding: "3px 8px",
                  borderRadius: 4,
                  background: "var(--dt-colors-background-surface-default, #1e1e2e)",
                  border: `1px solid ${directionColors[dir]}`,
                  opacity: 0.85,
                }}>
                  <span style={{ color: directionColors[dir] }}>{getNeighborIcon(n.type)}</span>
                  <Text textStyle="small">{n.name}</Text>
                  <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>{n.type}</Text>
                </Flex>
              ))}
            </Flex>
          </Flex>
        );
      })}
    </Flex>
  );
};

// ---- Spike selector ----
const SPIKE_OPTIONS = [
  { value: 1, label: "Normal" },
  { value: 1.5, label: "1.5x spike" },
  { value: 2, label: "2x spike" },
  { value: 3, label: "3x spike" },
  { value: 5, label: "5x spike" },
];

const HORIZON_OPTIONS: Array<{ value: number; label: string; interval?: string }> = [
  { value: 48, label: "48h" },
  { value: 168, label: "7 days" },
  { value: 90, label: "3 months", interval: "1d" },
  { value: 180, label: "6 months", interval: "1d" },
  { value: 270, label: "9 months", interval: "1d" },
  { value: 365, label: "12 months", interval: "1d" },
];

// ---- Main Sheet Component ----
export const HostDetailSheet: React.FC<HostDetailSheetProps> = ({
  host,
  show,
  onDismiss,
  timeframe,
}) => {
  const hostId = host?.id ?? null;

  const [spikeMultiplier, setSpikeMultiplier] = React.useState(1);
  const [forecastHorizon, setForecastHorizon] = React.useState(168);
  const [queryInterval, setQueryInterval] = React.useState<string | undefined>(undefined);

  const cpuForecast = useForecast(show ? hostId : null, "cpu", timeframe, forecastHorizon, queryInterval);
  const memForecast = useForecast(show ? hostId : null, "memory", timeframe, forecastHorizon, queryInterval);
  const diskForecast = useForecast(show ? hostId : null, "disk", timeframe, forecastHorizon, queryInterval);
  const { neighbors, status: neighborsStatus, error: neighborsError } = useHostNeighbors(show ? hostId : null);

  // Data readiness badge
  const dataStatus = useMemo(() => {
    if (!host) return { label: "—", color: CssTokens.textSecondary };
    if (host.forecastReady) return { label: `${host.dataPoints} pts — Ready`, color: CssTokens.feedbackSuccess };
    if (host.dataPoints > 0) return { label: `${host.dataPoints} pts — Limited`, color: CssTokens.feedbackWarning };
    return { label: "No data", color: CssTokens.feedbackCritical };
  }, [host]);

  const isAnyLoading = cpuForecast.status === "loading" || memForecast.status === "loading" || diskForecast.status === "loading";

  if (!host) return null;

  return (
    <Sheet
      show={show}
      title={host.name}
      onDismiss={onDismiss}
    >
      <Flex flexDirection="column" gap={12} padding={16} style={{ overflowY: "auto", height: "100%" }}>
        {/* Host header info */}
        <Flex alignItems="center" gap={12} flexWrap="wrap">
          <Flex alignItems="center" gap={6}>
            <HostsIcon />
            <Heading level={3}>{host.name}</Heading>
          </Flex>
          <Text textStyle="small-emphasized" style={{ padding: "2px 8px", borderRadius: 4, background: CssTokens.backgroundSurface, border: `1px solid ${dataStatus.color}`, color: dataStatus.color }}>
            {dataStatus.label}
          </Text>
          {isAnyLoading && <ProgressCircle size="small" />}
        </Flex>

        {/* What-if spike selector */}
        <Flex alignItems="center" gap={8} flexWrap="wrap">
          <Text textStyle="small-emphasized">What-if scenario:</Text>
          {SPIKE_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={spikeMultiplier === opt.value ? "accent" : "default"}
              onClick={() => setSpikeMultiplier(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </Flex>

        {/* Forecast horizon selector */}
        <Flex alignItems="center" gap={8} flexWrap="wrap">
          <Text textStyle="small-emphasized">Forecast horizon:</Text>
          {HORIZON_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={forecastHorizon === opt.value ? "accent" : "default"}
              onClick={() => { setForecastHorizon(opt.value); setQueryInterval(opt.interval); }}
            >
              {opt.label}
            </Button>
          ))}
        </Flex>

        {/* AI Analysis Cards */}
        <Flex gap={8} flexWrap="wrap">
          <AnalysisCard label="CPU" forecast={cpuForecast} spikeMultiplier={spikeMultiplier} />
          <AnalysisCard label="Memory" forecast={memForecast} spikeMultiplier={spikeMultiplier} />
          <AnalysisCard label="Disk" forecast={diskForecast} spikeMultiplier={spikeMultiplier} />
        </Flex>

        {/* Tabs: Forecasts + Topology */}
        <Tabs>
          <Tab title="CPU Forecast">
            <ForecastChart forecast={cpuForecast} metricLabel={METRICS.cpu.label} />
          </Tab>
          <Tab title="Memory Forecast">
            <ForecastChart forecast={memForecast} metricLabel={METRICS.memory.label} />
          </Tab>
          <Tab title="Disk Forecast">
            <ForecastChart forecast={diskForecast} metricLabel={METRICS.disk.label} />
          </Tab>
          <Tab title={`Topology (${neighbors.length})`}>
            <NeighborList neighbors={neighbors} status={neighborsStatus} error={neighborsError} />
          </Tab>
        </Tabs>
      </Flex>
    </Sheet>
  );
};
