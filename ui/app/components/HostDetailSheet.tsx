// ============================================================
// HostDetailSheet — Full-width sheet overlay for host analysis
// Contains: forecast charts, AI analysis, what-if spike, neighbors
// ============================================================

import React, { useMemo } from "react";
import { Sheet } from "@dynatrace/strato-components-preview/overlays";
import { Flex, Surface, Divider } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { Button } from "@dynatrace/strato-components/buttons";
import { ProgressCircle, Accordion } from "@dynatrace/strato-components/content";
import { Select } from "@dynatrace/strato-components/forms";
import {
  CriticalIcon,
  WarningIcon,
  SuccessIcon,
  CheckmarkIcon,
  HostsIcon,
} from "@dynatrace/strato-icons";
import { ForecastChart } from "./ForecastChart";
import { NeighborGraph } from "./NeighborGraph";
import { CapacityImpact } from "./CapacityImpact";
import { IntelligenceAnalyzer } from "./IntelligenceAnalyzer";
import { useForecast, METRICS } from "../hooks/useForecast";
import { useHostNeighbors } from "../hooks/useHostNeighbors";
import { useFailoverCandidates } from "../hooks/useFailoverCandidates";
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
  spikeForecast?: ForecastResult;
  spikeMultiplier: number;
}

function getAnalysisVerdict(forecast: ForecastResult, spikeMultiplier: number, spikeForecast?: ForecastResult) {
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

  // AI-powered spike: use Davis-computed forecast on scaled data when available
  let spikedMax: number;
  let spikedAvg: number;
  let spikeIsAI = false;

  if (spikeForecast && spikeForecast.status === "success") {
    const spikeUpper = spikeForecast.forecastUpper.filter((v) => v != null);
    const spikePts = spikeForecast.forecastPoint.filter((v) => v != null);
    spikedMax = spikeUpper.length > 0 ? Math.max(...spikeUpper) : fcastMax * spikeMultiplier;
    spikedAvg = spikePts.length > 0 ? spikePts.reduce((a, b) => a + b, 0) / spikePts.length : fcastAvg * spikeMultiplier;
    spikeIsAI = true;
  } else {
    // Fallback to math while AI spike forecast is loading or unavailable
    spikedMax = fcastMax * spikeMultiplier;
    spikedAvg = fcastAvg * spikeMultiplier;
  }

  return { current, histAvg, histMax, trend, trendPct, fcastAvg, fcastMax, spikedMax, spikedAvg, spikeIsAI };
}

const AnalysisCard: React.FC<AnalysisCardProps> = ({ label, forecast, spikeForecast, spikeMultiplier }) => {
  const analysis = getAnalysisVerdict(forecast, spikeMultiplier, spikeForecast);

  if (forecast.status === "loading") {
    return (
      <Surface style={{ flex: "1 1 280px" }}>
        <Flex padding={16} gap={8} alignItems="center">
          <ProgressCircle size="small" />
          <Text>{label}: Running forecast…</Text>
        </Flex>
      </Surface>
    );
  }

  if (forecast.status === "error") {
    return (
      <Surface style={{ flex: "1 1 280px" }}>
        <Flex padding={16} gap={8} alignItems="center">
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
      <Surface style={{ flex: "1 1 280px" }}>
        <Flex padding={16}>
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
    <Surface style={{ flex: "1 1 280px" }}>
      <Flex flexDirection="column" padding={16} gap={8}>
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
              <Flex alignItems="center" gap={4}>
                <Text textStyle="small" style={{ color: CssTokens.feedbackWarning }}>Spike {spikeMultiplier}x Peak</Text>
                {analysis.spikeIsAI ? (
                  <Text textStyle="small-emphasized" style={{ color: CssTokens.feedbackSuccess, fontSize: 10 }}>DT Intelligence</Text>
                ) : spikeForecast?.status === "loading" ? (
                  <ProgressCircle size="small" />
                ) : null}
              </Flex>
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

  // AI-powered spike forecasts — Davis re-runs forecast on scaled timeseries data
  // Only active when spikeMultiplier > 1; produces proper statistical confidence intervals
  const cpuSpike = useForecast(show && spikeMultiplier > 1 ? hostId : null, "cpu", timeframe, forecastHorizon, queryInterval, spikeMultiplier);
  const memSpike = useForecast(show && spikeMultiplier > 1 ? hostId : null, "memory", timeframe, forecastHorizon, queryInterval, spikeMultiplier);
  const diskSpike = useForecast(show && spikeMultiplier > 1 ? hostId : null, "disk", timeframe, forecastHorizon, queryInterval, spikeMultiplier);

  const { neighbors, status: neighborsStatus, error: neighborsError } = useHostNeighbors(show ? hostId : null);
  const { analysis: failoverAnalysis, status: failoverStatus } = useFailoverCandidates(show ? hostId : null);

  // Data readiness badge
  const dataStatus = useMemo(() => {
    if (!host) return { label: "—", color: CssTokens.textSecondary };
    if (host.forecastReady) return { label: `${host.dataPoints} pts — Ready`, color: CssTokens.feedbackSuccess };
    if (host.dataPoints > 0) return { label: `${host.dataPoints} pts — Limited`, color: CssTokens.feedbackWarning };
    return { label: "No data", color: CssTokens.feedbackCritical };
  }, [host]);

  const isAnyLoading = cpuForecast.status === "loading" || memForecast.status === "loading" || diskForecast.status === "loading"
    || cpuSpike.status === "loading" || memSpike.status === "loading" || diskSpike.status === "loading";

  if (!host) return null;

  return (
    <Sheet
      show={show}
      title={host.name}
      onDismiss={onDismiss}
    >
      <Flex flexDirection="column" gap={12} padding={16} style={{ overflowY: "auto", height: "100%" }}>
        {/* Host header info */}
        <Flex alignItems="center" gap={12} flexWrap="wrap" style={{ paddingBottom: 12, borderBottom: `1px solid var(--dt-colors-border-neutral-default)` }}>
          <Flex alignItems="center" gap={6}>
            <HostsIcon />
            <Heading level={3}>{host.name}</Heading>
          </Flex>
          <Text textStyle="small-emphasized" style={{ padding: "2px 8px", borderRadius: 4, background: CssTokens.backgroundSurface, border: `1px solid ${dataStatus.color}`, color: dataStatus.color }}>
            {dataStatus.label}
          </Text>
          {isAnyLoading && <ProgressCircle size="small" />}
        </Flex>

        {/* Forecast controls — single row: horizon buttons + spike dropdown */}
        <Flex alignItems="center" gap={8} flexWrap="wrap">
          <Text textStyle="small-emphasized">Forecast:</Text>
          {HORIZON_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={forecastHorizon === opt.value ? "accent" : "default"}
              onClick={() => { setForecastHorizon(opt.value); setQueryInterval(opt.interval); }}
            >
              {opt.label}
            </Button>
          ))}
          <Flex alignItems="center" gap={6} style={{ marginLeft: "auto" }}>
            <Text textStyle="small-emphasized">Spike:</Text>
            <Select
              value={String(spikeMultiplier)}
              onChange={(value) => setSpikeMultiplier(Number(value) || 1)}
            >
              <Select.Content style={{ minWidth: 120 }}>
                {SPIKE_OPTIONS.map((opt) => (
                  <Select.Option key={opt.value} value={String(opt.value)}>{opt.label}</Select.Option>
                ))}
              </Select.Content>
            </Select>
          </Flex>
        </Flex>

        <Divider />

        {/* AI Analysis Cards */}
        <Flex gap={8} flexWrap="wrap">
          <AnalysisCard label="CPU" forecast={cpuForecast} spikeForecast={spikeMultiplier > 1 ? cpuSpike : undefined} spikeMultiplier={spikeMultiplier} />
          <AnalysisCard label="Memory" forecast={memForecast} spikeForecast={spikeMultiplier > 1 ? memSpike : undefined} spikeMultiplier={spikeMultiplier} />
          <AnalysisCard label="Disk" forecast={diskForecast} spikeForecast={spikeMultiplier > 1 ? diskSpike : undefined} spikeMultiplier={spikeMultiplier} />
        </Flex>

        {/* Tabs: Forecasts + Topology */}
        <Flex style={{ marginTop: 8 }}>
          <div style={{ width: "100%" }}>
        <Tabs>
          <Tab title="Intelligence Report">
            <IntelligenceAnalyzer
              hostName={host.name}
              cpuForecast={cpuForecast}
              memForecast={memForecast}
              diskForecast={diskForecast}
              cpuSpike={spikeMultiplier > 1 ? cpuSpike : undefined}
              memSpike={spikeMultiplier > 1 ? memSpike : undefined}
              diskSpike={spikeMultiplier > 1 ? diskSpike : undefined}
              spikeMultiplier={spikeMultiplier}
              neighbors={neighbors}
              neighborsStatus={neighborsStatus}
              failover={failoverAnalysis}
              failoverStatus={failoverStatus}
              forecastHorizon={forecastHorizon}
            />
          </Tab>
          <Tab title="CPU Forecast">
            <ForecastChart forecast={cpuForecast} metricLabel={METRICS.cpu.label} />
          </Tab>
          <Tab title="Memory Forecast">
            <ForecastChart forecast={memForecast} metricLabel={METRICS.memory.label} />
          </Tab>
          <Tab title="Disk Forecast">
            <ForecastChart forecast={diskForecast} metricLabel={METRICS.disk.label} />
          </Tab>
          <Tab title={`Capacity Impact (${neighbors.length})`}>
            <Flex flexDirection="column" gap={12}>
              <CapacityImpact neighbors={neighbors} status={neighborsStatus} error={neighborsError} hostName={host.name} failover={failoverAnalysis} failoverStatus={failoverStatus} />
              <Accordion>
                <Accordion.Section id="topo-graph" title={`Topology Graph (${neighbors.length} entities)`}>
                  <NeighborGraph neighbors={neighbors} status={neighborsStatus} error={neighborsError} hostId={host.id} hostName={host.name} />
                </Accordion.Section>
              </Accordion>
            </Flex>
          </Tab>
        </Tabs>
          </div>
        </Flex>
      </Flex>
    </Sheet>
  );
};
