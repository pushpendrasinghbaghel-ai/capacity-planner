// ============================================================
// IntelligenceAnalyzer — Dynatrace Intelligence Capacity Report
// Synthesizes: forecasts + topology + failover into actionable
// intelligence with composite scoring and recommendations
// ============================================================

import React, { useMemo } from "react";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { ProgressBar, ProgressCircle } from "@dynatrace/strato-components/content";
import {
  CriticalIcon,
  WarningIcon,
  SuccessIcon,
  CheckmarkIcon,
  HostsIcon,
  ServicesIcon,
} from "@dynatrace/strato-icons";
import type { ForecastResult } from "../hooks/useForecast";
import type { NeighborNode } from "../hooks/useHostNeighbors";
import type { FailoverAnalysis } from "../hooks/useFailoverCandidates";
import { CssTokens } from "../utils/design-tokens";
import { formatPercent } from "../utils/formatting";

// ---- Types ----
export interface IntelligenceAnalyzerProps {
  hostName: string;
  cpuForecast: ForecastResult;
  memForecast: ForecastResult;
  diskForecast: ForecastResult;
  cpuSpike?: ForecastResult;
  memSpike?: ForecastResult;
  diskSpike?: ForecastResult;
  spikeMultiplier: number;
  neighbors: NeighborNode[];
  neighborsStatus: string;
  failover: FailoverAnalysis | null;
  failoverStatus: string;
  forecastHorizon: number;
}

// ---- Metric Analysis ----
interface MetricInsight {
  name: string;
  current: number;
  histAvg: number;
  histMax: number;
  trendPct: number;
  forecastPeak: number;
  spikedPeak: number;
  daysToExhaustion: number | null;
  volatility: number;
  severity: "critical" | "warning" | "healthy" | "over_provisioned";
  spikeIsAI: boolean;
}

function analyzeMetric(
  name: string,
  forecast: ForecastResult,
  spikeForecast: ForecastResult | undefined,
  spikeMultiplier: number,
  forecastHorizon: number,
): MetricInsight | null {
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

  // Volatility: standard deviation / mean (coefficient of variation)
  const variance = hist.reduce((s, v) => s + (v - histAvg) ** 2, 0) / hist.length;
  const volatility = histAvg > 0 ? Math.sqrt(variance) / histAvg : 0;

  const forecastPeak = upper.length > 0 ? Math.max(...upper) : (pts.length > 0 ? Math.max(...pts) : current);

  // Spike analysis
  let spikedPeak: number;
  let spikeIsAI = false;
  if (spikeForecast && spikeForecast.status === "success") {
    const spikeUpper = spikeForecast.forecastUpper.filter((v) => v != null);
    spikedPeak = spikeUpper.length > 0 ? Math.max(...spikeUpper) : forecastPeak * spikeMultiplier;
    spikeIsAI = true;
  } else {
    spikedPeak = forecastPeak * spikeMultiplier;
  }

  // Days to exhaustion estimate (linear projection from trend)
  let daysToExhaustion: number | null = null;
  if (trendPct > 0 && current < 95) {
    const dailyGrowthPct = trendPct / (forecastHorizon / 24);
    if (dailyGrowthPct > 0) {
      const remaining = 95 - current;
      daysToExhaustion = Math.round(remaining / (current * dailyGrowthPct / 100));
      if (daysToExhaustion > 3650) daysToExhaustion = null; // > 10 years = effectively infinite
    }
  }

  const severity: MetricInsight["severity"] =
    forecastPeak >= 90 || current >= 85 ? "critical" :
    forecastPeak >= 75 || current >= 70 ? "warning" :
    current < 15 && forecastPeak < 25 ? "over_provisioned" :
    "healthy";

  return { name, current, histAvg, histMax, trendPct, forecastPeak, spikedPeak, daysToExhaustion, volatility, severity, spikeIsAI };
}

// ---- Composite Score ----
interface CompositeScore {
  overall: number;
  resourceScore: number;
  topologyScore: number;
  resilienceScore: number;
  grade: string;
  gradeColor: string;
}

function computeComposite(
  metrics: MetricInsight[],
  neighbors: NeighborNode[],
  failover: FailoverAnalysis | null,
): CompositeScore {
  // Resource score: inverse of worst forecast peak (lower peak = better)
  const worstPeak = Math.max(...metrics.map((m) => m.forecastPeak), 0);
  const resourceScore = Math.max(0, Math.min(100, Math.round(100 - worstPeak)));

  // Topology score: based on blast radius (fewer dependencies = less risk)
  const processCount = neighbors.filter((n) => n.direction === "runs_on").length;
  const upstreamCount = neighbors.filter((n) => n.direction === "upstream").length;
  const topologyRaw = processCount * 2 + upstreamCount * 3;
  const topologyScore = Math.max(0, Math.min(100, Math.round(100 - Math.min(topologyRaw, 100))));

  // Resilience score: based on failover coverage
  let resilienceScore = 50; // default when no data
  if (failover && failover.services.length > 0) {
    const coverage = failover.redundantServices.length / failover.services.length;
    resilienceScore = Math.round(coverage * 100);
  }

  // Weighted composite: resource health is most important
  const overall = Math.round(resourceScore * 0.5 + topologyScore * 0.2 + resilienceScore * 0.3);

  const grade =
    overall >= 90 ? "A" :
    overall >= 75 ? "B" :
    overall >= 60 ? "C" :
    overall >= 40 ? "D" : "F";
  const gradeColor =
    overall >= 75 ? CssTokens.feedbackSuccess :
    overall >= 50 ? CssTokens.feedbackWarning :
    CssTokens.feedbackCritical;

  return { overall, resourceScore, topologyScore, resilienceScore, grade, gradeColor };
}

// ---- Recommendation Engine ----
interface Recommendation {
  priority: "critical" | "high" | "medium" | "low";
  action: string;
  reason: string;
  impact: string;
}

function generateRecommendations(
  metrics: MetricInsight[],
  neighbors: NeighborNode[],
  failover: FailoverAnalysis | null,
  spikeMultiplier: number,
): Recommendation[] {
  const recs: Recommendation[] = [];

  for (const m of metrics) {
    // Critical capacity
    if (m.forecastPeak >= 90) {
      recs.push({
        priority: "critical",
        action: `Scale ${m.name} capacity immediately`,
        reason: `Dynatrace Intelligence forecasts ${m.name} reaching ${formatPercent(m.forecastPeak)} peak — exhaustion imminent`,
        impact: m.daysToExhaustion != null ? `Estimated ${m.daysToExhaustion} days to capacity limit` : "Capacity limit breach projected within forecast window",
      });
    }
    // Warning capacity
    else if (m.forecastPeak >= 75) {
      recs.push({
        priority: "high",
        action: `Plan ${m.name} upgrade within next cycle`,
        reason: `Dynatrace Intelligence forecasts ${m.name} peak at ${formatPercent(m.forecastPeak)} — approaching threshold`,
        impact: m.daysToExhaustion != null ? `~${m.daysToExhaustion} days headroom remaining` : "Moderate capacity risk in forecast window",
      });
    }
    // Over-provisioned
    if (m.severity === "over_provisioned") {
      recs.push({
        priority: "medium",
        action: `Rightsize ${m.name} — currently over-provisioned`,
        reason: `${m.name} averaging ${formatPercent(m.histAvg)} with peak forecast ${formatPercent(m.forecastPeak)}`,
        impact: "Potential cost savings by downsizing to a smaller instance type",
      });
    }
    // High volatility
    if (m.volatility > 0.4 && m.severity !== "critical") {
      recs.push({
        priority: "medium",
        action: `Investigate ${m.name} volatility`,
        reason: `${m.name} shows ${(m.volatility * 100).toFixed(0)}% coefficient of variation — unpredictable load patterns`,
        impact: "Volatile metrics reduce forecast confidence. Consider auto-scaling or load balancing",
      });
    }
    // Spike vulnerability
    if (spikeMultiplier > 1 && m.spikedPeak >= 90 && m.forecastPeak < 90) {
      recs.push({
        priority: "high",
        action: `${m.name} is spike-vulnerable at ${spikeMultiplier}x`,
        reason: `Normal forecast ${formatPercent(m.forecastPeak)} but ${spikeMultiplier}x spike pushes to ${formatPercent(m.spikedPeak)}`,
        impact: "Consider capacity buffer or burst-capable instance type for traffic spikes",
      });
    }
  }

  // Failover gaps
  if (failover && failover.singlePointServices.length > 0) {
    recs.push({
      priority: "critical",
      action: `Eliminate ${failover.singlePointServices.length} single-point-of-failure service${failover.singlePointServices.length !== 1 ? "s" : ""}`,
      reason: `Services without failover: ${failover.singlePointServices.slice(0, 3).map((s) => s.serviceName).join(", ")}${failover.singlePointServices.length > 3 ? ` +${failover.singlePointServices.length - 3} more` : ""}`,
      impact: "Host failure will cause complete service outage for these services",
    });
  }

  // High blast radius
  const upstreamCount = neighbors.filter((n) => n.direction === "upstream").length;
  if (upstreamCount >= 20) {
    recs.push({
      priority: "high",
      action: "Reduce blast radius — high upstream dependency count",
      reason: `${upstreamCount} upstream callers depend on this host`,
      impact: "Capacity issues will cascade to many dependent services",
    });
  }

  // Sort by priority
  const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  recs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return recs;
}

// ---- Sub-components ----
const ScoreGauge: React.FC<{
  label: string;
  score: number;
  color?: string;
}> = ({ label, score, color }) => {
  const barColor =
    score >= 75 ? "success" as const :
    score >= 50 ? "warning" as const :
    "critical" as const;
  return (
    <Flex flexDirection="column" gap={4} style={{ flex: "1 1 0", minWidth: 120 }}>
      <Flex justifyContent="space-between" alignItems="center">
        <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>{label}</Text>
        <Text textStyle="small-emphasized" style={{ color: color ?? CssTokens.textPrimary }}>{score}/100</Text>
      </Flex>
      <ProgressBar value={score} max={100} color={barColor} density="condensed">
        <ProgressBar.Label />
      </ProgressBar>
    </Flex>
  );
};

const PriorityBadge: React.FC<{ priority: Recommendation["priority"] }> = ({ priority }) => {
  const config = {
    critical: { bg: CssTokens.feedbackCritical, label: "CRITICAL" },
    high: { bg: CssTokens.feedbackWarning, label: "HIGH" },
    medium: { bg: CssTokens.feedbackInfo, label: "MEDIUM" },
    low: { bg: CssTokens.textSecondary, label: "LOW" },
  }[priority];

  return (
    <Text textStyle="small-emphasized" style={{
      color: config.bg,
      padding: "1px 6px",
      borderRadius: 3,
      border: `1px solid ${config.bg}`,
      whiteSpace: "nowrap",
      flexShrink: 0,
    }}>
      {config.label}
    </Text>
  );
};

const MetricRow: React.FC<{ metric: MetricInsight; spikeMultiplier: number }> = ({ metric, spikeMultiplier }) => {
  const severityIcon =
    metric.severity === "critical" ? <CriticalIcon style={{ color: CssTokens.feedbackCritical }} /> :
    metric.severity === "warning" ? <WarningIcon style={{ color: CssTokens.feedbackWarning }} /> :
    <SuccessIcon style={{ color: CssTokens.feedbackSuccess }} />;

  return (
    <Flex alignItems="center" gap={12} style={{ padding: "8px 0", borderBottom: `1px solid var(--dt-colors-border-neutral-default)` }}>
      <Flex alignItems="center" gap={6} style={{ minWidth: 100 }}>
        {severityIcon}
        <Text textStyle="base-emphasized">{metric.name}</Text>
      </Flex>
      <Flex gap={20} flexWrap="wrap" style={{ flex: 1 }}>
        <Flex flexDirection="column" gap={1} style={{ minWidth: 60 }}>
          <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>Current</Text>
          <Text textStyle="small-emphasized">{formatPercent(metric.current)}</Text>
        </Flex>
        <Flex flexDirection="column" gap={1} style={{ minWidth: 60 }}>
          <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>Avg</Text>
          <Text textStyle="small-emphasized">{formatPercent(metric.histAvg)}</Text>
        </Flex>
        <Flex flexDirection="column" gap={1} style={{ minWidth: 60 }}>
          <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>Trend</Text>
          <Text textStyle="small-emphasized" style={{ color: metric.trendPct > 5 ? CssTokens.feedbackWarning : metric.trendPct < -5 ? CssTokens.feedbackSuccess : CssTokens.textPrimary }}>
            {metric.trendPct > 0 ? "+" : ""}{metric.trendPct.toFixed(1)}%
          </Text>
        </Flex>
        <Flex flexDirection="column" gap={1} style={{ minWidth: 80 }}>
          <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>Forecast Peak</Text>
          <Text textStyle="small-emphasized" style={{ color: metric.forecastPeak >= 85 ? CssTokens.feedbackCritical : metric.forecastPeak >= 70 ? CssTokens.feedbackWarning : CssTokens.textPrimary }}>
            {formatPercent(metric.forecastPeak)}
          </Text>
        </Flex>
        {spikeMultiplier > 1 && (
          <Flex flexDirection="column" gap={1} style={{ minWidth: 80 }}>
            <Flex alignItems="center" gap={4}>
              <Text textStyle="small" style={{ color: CssTokens.feedbackWarning }}>{spikeMultiplier}x Peak</Text>
              {metric.spikeIsAI && <Text textStyle="small" style={{ color: CssTokens.feedbackSuccess, fontSize: 9 }}>AI</Text>}
            </Flex>
            <Text textStyle="small-emphasized" style={{ color: metric.spikedPeak >= 85 ? CssTokens.feedbackCritical : CssTokens.textPrimary }}>
              {formatPercent(metric.spikedPeak)}
            </Text>
          </Flex>
        )}
        <Flex flexDirection="column" gap={1} style={{ minWidth: 80 }}>
          <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>Exhaustion</Text>
          <Text textStyle="small-emphasized" style={{ color: metric.daysToExhaustion != null && metric.daysToExhaustion < 90 ? CssTokens.feedbackCritical : CssTokens.textPrimary }}>
            {metric.daysToExhaustion != null ? `${metric.daysToExhaustion}d` : "—"}
          </Text>
        </Flex>
        <Flex flexDirection="column" gap={1} style={{ minWidth: 70 }}>
          <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>Volatility</Text>
          <Text textStyle="small-emphasized" style={{ color: metric.volatility > 0.4 ? CssTokens.feedbackWarning : CssTokens.textPrimary }}>
            {(metric.volatility * 100).toFixed(0)}%
          </Text>
        </Flex>
      </Flex>
    </Flex>
  );
};

// ============================================================
// Main Component
// ============================================================
export const IntelligenceAnalyzer: React.FC<IntelligenceAnalyzerProps> = ({
  hostName,
  cpuForecast,
  memForecast,
  diskForecast,
  cpuSpike,
  memSpike,
  diskSpike,
  spikeMultiplier,
  neighbors,
  neighborsStatus,
  failover,
  failoverStatus,
  forecastHorizon,
}) => {
  const isLoading = cpuForecast.status === "loading" || memForecast.status === "loading" || diskForecast.status === "loading"
    || neighborsStatus === "loading" || failoverStatus === "loading";

  const analysis = useMemo(() => {
    const metrics: MetricInsight[] = [];
    const cpu = analyzeMetric("CPU", cpuForecast, cpuSpike, spikeMultiplier, forecastHorizon);
    const mem = analyzeMetric("Memory", memForecast, memSpike, spikeMultiplier, forecastHorizon);
    const disk = analyzeMetric("Disk", diskForecast, diskSpike, spikeMultiplier, forecastHorizon);
    if (cpu) metrics.push(cpu);
    if (mem) metrics.push(mem);
    if (disk) metrics.push(disk);

    if (metrics.length === 0) return null;

    const composite = computeComposite(metrics, neighbors, failover);
    const recommendations = generateRecommendations(metrics, neighbors, failover, spikeMultiplier);

    // Constraint summary
    const constraintMetric = metrics.reduce((worst, m) =>
      m.forecastPeak > worst.forecastPeak ? m : worst, metrics[0]);
    const secondaryConstraint = metrics.length > 1
      ? metrics.filter((m) => m !== constraintMetric).reduce((worst, m) =>
        m.forecastPeak > worst.forecastPeak ? m : worst, metrics.filter((m) => m !== constraintMetric)[0])
      : null;

    // Topology summary
    const processCount = neighbors.filter((n) => n.direction === "runs_on").length;
    const serviceCount = neighbors.filter((n) => ["SERVICE"].includes(n.type)).length;
    const upstreamCount = neighbors.filter((n) => n.direction === "upstream").length;
    const downstreamCount = neighbors.filter((n) => n.direction === "downstream").length;

    return {
      metrics,
      composite,
      recommendations,
      constraintMetric,
      secondaryConstraint,
      topology: { processCount, serviceCount, upstreamCount, downstreamCount },
    };
  }, [cpuForecast, memForecast, diskForecast, cpuSpike, memSpike, diskSpike, spikeMultiplier, forecastHorizon, neighbors, failover]);

  if (isLoading && !analysis) {
    return (
      <Surface>
        <Flex flexDirection="column" padding={24} gap={16} alignItems="center" justifyContent="center" style={{ minHeight: 200 }}>
          <ProgressCircle />
          <Text textStyle="base-emphasized">Dynatrace Intelligence Analyzer</Text>
          <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>
            Running Dynatrace Intelligence forecasts and topology analysis…
          </Text>
        </Flex>
      </Surface>
    );
  }

  if (!analysis) {
    return (
      <Surface>
        <Flex padding={24} alignItems="center" justifyContent="center">
          <Text style={{ color: CssTokens.textSecondary }}>Insufficient data for intelligence analysis. At least one forecast must complete.</Text>
        </Flex>
      </Surface>
    );
  }

  const { composite, metrics, recommendations, constraintMetric, topology } = analysis;

  // Generate executive summary text
  const summaryLines: string[] = [];
  if (constraintMetric.severity === "critical") {
    summaryLines.push(`Primary constraint is ${constraintMetric.name} at ${formatPercent(constraintMetric.forecastPeak)} forecast peak — immediate action required.`);
  } else if (constraintMetric.severity === "warning") {
    summaryLines.push(`${constraintMetric.name} is the leading concern at ${formatPercent(constraintMetric.forecastPeak)} forecast peak — plan capacity upgrade.`);
  } else if (constraintMetric.severity === "over_provisioned") {
    summaryLines.push(`All resources are well within limits. ${constraintMetric.name} peaks at only ${formatPercent(constraintMetric.forecastPeak)} — consider rightsizing.`);
  } else {
    summaryLines.push(`All resources healthy. ${constraintMetric.name} leads at ${formatPercent(constraintMetric.forecastPeak)} forecast peak with comfortable headroom.`);
  }

  if (failover && failover.singlePointServices.length > 0) {
    summaryLines.push(`${failover.singlePointServices.length} service${failover.singlePointServices.length !== 1 ? "s" : ""} lack failover — resilience risk.`);
  }
  if (topology.upstreamCount >= 20) {
    summaryLines.push(`High blast radius with ${topology.upstreamCount} upstream dependencies.`);
  }

  const criticalCount = recommendations.filter((r) => r.priority === "critical").length;
  const highCount = recommendations.filter((r) => r.priority === "high").length;

  return (
    <Flex flexDirection="column" gap={16}>
      {/* Header: Grade + Composite Scores */}
      <Surface>
        <Flex padding={20} gap={20} flexWrap="wrap" alignItems="center">
          {/* Grade circle */}
          <Flex flexDirection="column" alignItems="center" gap={4} style={{ minWidth: 80 }}>
            <Flex alignItems="center" justifyContent="center" style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              border: `3px solid ${composite.gradeColor}`,
              background: CssTokens.backgroundSurface,
            }}>
              <Text style={{ fontSize: 28, fontWeight: 700, color: composite.gradeColor }}>{composite.grade}</Text>
            </Flex>
            <Text textStyle="small-emphasized" style={{ color: composite.gradeColor }}>
              {composite.overall}/100
            </Text>
          </Flex>

          {/* Score breakdown */}
          <Flex flexDirection="column" gap={8} style={{ flex: 1, minWidth: 200 }}>
            <Flex alignItems="center" gap={8}>
              <Heading level={5}>Capacity Intelligence Report</Heading>
              {isLoading && <ProgressCircle size="small" />}
              <Text textStyle="small" style={{ color: CssTokens.feedbackSuccess, marginLeft: "auto" }}>
                Powered by Dynatrace Intelligence
              </Text>
            </Flex>
            <Flex gap={16} flexWrap="wrap">
              <ScoreGauge label="Resource Health" score={composite.resourceScore} />
              <ScoreGauge label="Topology Risk" score={composite.topologyScore} />
              <ScoreGauge label="Resilience" score={composite.resilienceScore} />
            </Flex>
          </Flex>
        </Flex>
      </Surface>

      {/* Executive Summary */}
      <Surface>
        <Flex flexDirection="column" padding={20} gap={10}>
          <Heading level={5}>Executive Summary</Heading>
          {summaryLines.map((line, i) => (
            <Text key={i} textStyle="base" style={{ color: CssTokens.textPrimary, lineHeight: 1.5 }}>{line}</Text>
          ))}
          <Flex gap={12} flexWrap="wrap" style={{ marginTop: 4 }}>
            <Flex alignItems="center" gap={6}>
              <HostsIcon style={{ color: CssTokens.textSecondary }} />
              <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>
                {topology.processCount} processes · {topology.serviceCount} services · {topology.upstreamCount} upstream · {topology.downstreamCount} downstream
              </Text>
            </Flex>
            {failover && (
              <Flex alignItems="center" gap={6}>
                <ServicesIcon style={{ color: CssTokens.textSecondary }} />
                <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>
                  {failover.services.length} hosted services · {failover.uniquePeerHosts.length} failover peers
                </Text>
              </Flex>
            )}
          </Flex>
        </Flex>
      </Surface>

      {/* Metric-by-Metric Forecast Analysis */}
      <Surface>
        <Flex flexDirection="column" padding={20} gap={8}>
          <Heading level={5}>Forecast Analysis</Heading>
          {metrics.map((m) => (
            <MetricRow key={m.name} metric={m} spikeMultiplier={spikeMultiplier} />
          ))}
        </Flex>
      </Surface>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <Surface>
          <Flex flexDirection="column" padding={20} gap={12}>
            <Flex alignItems="center" gap={8}>
              <Heading level={5}>AI Recommendations</Heading>
              {criticalCount > 0 && (
                <Text textStyle="small-emphasized" style={{ color: CssTokens.feedbackCritical }}>
                  {criticalCount} critical
                </Text>
              )}
              {highCount > 0 && (
                <Text textStyle="small-emphasized" style={{ color: CssTokens.feedbackWarning }}>
                  {highCount} high
                </Text>
              )}
            </Flex>
            {recommendations.map((rec, i) => (
              <Flex key={i} gap={12} alignItems="flex-start" style={{
                padding: 12,
                borderRadius: 6,
                border: `1px solid var(--dt-colors-border-neutral-default)`,
                background: CssTokens.backgroundSurface,
              }}>
                <PriorityBadge priority={rec.priority} />
                <Flex flexDirection="column" gap={4} style={{ flex: 1 }}>
                  <Text textStyle="base-emphasized">{rec.action}</Text>
                  <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>{rec.reason}</Text>
                  <Flex alignItems="center" gap={4}>
                    <CheckmarkIcon style={{ color: CssTokens.feedbackInfo, flexShrink: 0 }} />
                    <Text textStyle="small" style={{ color: CssTokens.textPrimary }}>{rec.impact}</Text>
                  </Flex>
                </Flex>
              </Flex>
            ))}
          </Flex>
        </Surface>
      )}

      {/* Risk Matrix */}
      <Surface>
        <Flex flexDirection="column" padding={20} gap={12}>
          <Heading level={5}>Risk Assessment Matrix</Heading>
          <Flex gap={16} flexWrap="wrap">
            {/* Spike Vulnerability */}
            <Flex flexDirection="column" gap={6} style={{ flex: "1 1 calc(50% - 8px)", minWidth: 200 }}>
              <Text textStyle="small-emphasized">Spike Vulnerability</Text>
              {spikeMultiplier > 1 ? (
                metrics.map((m) => {
                  const delta = m.spikedPeak - m.forecastPeak;
                  const vulnerable = m.spikedPeak >= 85;
                  return (
                    <Flex key={m.name} alignItems="center" gap={8}>
                      {vulnerable ? <CriticalIcon style={{ color: CssTokens.feedbackCritical }} /> : <CheckmarkIcon style={{ color: CssTokens.feedbackSuccess }} />}
                      <Text textStyle="small">
                        {m.name}: +{formatPercent(delta)} at {spikeMultiplier}x → {formatPercent(m.spikedPeak)}
                      </Text>
                    </Flex>
                  );
                })
              ) : (
                <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>
                  Select a spike multiplier to analyze vulnerability
                </Text>
              )}
            </Flex>

            {/* Exhaustion Timeline */}
            <Flex flexDirection="column" gap={6} style={{ flex: "1 1 calc(50% - 8px)", minWidth: 200 }}>
              <Text textStyle="small-emphasized">Exhaustion Timeline</Text>
              {metrics.map((m) => (
                <Flex key={m.name} alignItems="center" gap={8}>
                  {m.daysToExhaustion != null && m.daysToExhaustion < 90 ? (
                    <CriticalIcon style={{ color: CssTokens.feedbackCritical }} />
                  ) : m.daysToExhaustion != null && m.daysToExhaustion < 180 ? (
                    <WarningIcon style={{ color: CssTokens.feedbackWarning }} />
                  ) : (
                    <CheckmarkIcon style={{ color: CssTokens.feedbackSuccess }} />
                  )}
                  <Text textStyle="small">
                    {m.name}: {m.daysToExhaustion != null ? `${m.daysToExhaustion} days` : "No exhaustion projected"}
                  </Text>
                </Flex>
              ))}
            </Flex>
          </Flex>
        </Flex>
      </Surface>
    </Flex>
  );
};
