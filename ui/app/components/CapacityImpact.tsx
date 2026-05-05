// ============================================================
// CapacityImpact — Topology-aware capacity analysis panel
// Shows: blast radius, cascade risk, workload density,
//        dependency priority, and failover candidates
// Replaces raw Smartscape graph with actionable insights
// ============================================================

import React, { useMemo } from "react";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { ProgressBar } from "@dynatrace/strato-components/content";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import {
  CriticalIcon,
  WarningIcon,
  SuccessIcon,
  HostsIcon,
  ServicesIcon,
  ContainerIcon,
} from "@dynatrace/strato-icons";
import type { NeighborNode } from "../hooks/useHostNeighbors";
import type { FailoverAnalysis } from "../hooks/useFailoverCandidates";
import { CssTokens } from "../utils/design-tokens";

// ---- Types ----
export interface CapacityImpactProps {
  neighbors: NeighborNode[];
  status: string;
  error: string | null;
  hostName: string;
  /** Service-aware failover analysis */
  failover?: FailoverAnalysis | null;
  failoverStatus?: string;
}

// ---- Helpers ----
function countByType(neighbors: NeighborNode[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of neighbors) m.set(n.type, (m.get(n.type) ?? 0) + 1);
  return m;
}

function tierLabel(callers: number): { label: string; color: string; headroom: string } {
  if (callers >= 50) return { label: "Tier-1 Critical", color: CssTokens.feedbackCritical, headroom: "≥ 30% headroom" };
  if (callers >= 10) return { label: "Tier-2 Important", color: CssTokens.feedbackWarning, headroom: "≥ 20% headroom" };
  return { label: "Tier-3 Standard", color: CssTokens.feedbackSuccess, headroom: "≥ 10% headroom" };
}

// ---- Section Card ----
const SectionCard: React.FC<{
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, children }) => (
  <Surface style={{ flex: "1 1 calc(50% - 8px)", minHeight: 180 }}>
    <Flex flexDirection="column" padding={20} gap={12}>
      <Flex alignItems="center" gap={8}>
        {icon}
        <Heading level={5}>{title}</Heading>
      </Flex>
      {children}
    </Flex>
  </Surface>
);

// ============================================================
// Main Component
// ============================================================
export const CapacityImpact: React.FC<CapacityImpactProps> = ({
  neighbors,
  status,
  error,
  hostName,
  failover,
  failoverStatus,
}) => {
  const analysis = useMemo(() => {
    if (neighbors.length === 0) return null;

    const upstream = neighbors.filter((n) => n.direction === "upstream");
    const downstream = neighbors.filter((n) => n.direction === "downstream");
    const processes = neighbors.filter((n) => n.direction === "runs_on");

    const byType = countByType(neighbors);
    const totalInboundCalls = upstream.reduce((s, n) => s + (n.callCount ?? 0), 0);
    const totalOutboundCalls = downstream.reduce((s, n) => s + (n.callCount ?? 0), 0);

    // Workload density
    const processCount = processes.length;
    const containerCount = byType.get("CONTAINER") ?? 0;
    const serviceCount = (byType.get("SERVICE") ?? 0);

    // Dependency tier
    const callerCount = upstream.length;
    const tier = tierLabel(callerCount);

    // Top callers by volume
    const topCallers = [...upstream]
      .filter((n) => n.callCount != null && n.callCount > 0)
      .sort((a, b) => (b.callCount ?? 0) - (a.callCount ?? 0))
      .slice(0, 5);

    return {
      upstream,
      downstream,
      processes,
      byType,
      totalInboundCalls,
      totalOutboundCalls,
      processCount,
      containerCount,
      serviceCount,
      callerCount,
      tier,
      topCallers,
    };
  }, [neighbors]);

  if (status === "loading") {
    return (
      <Flex alignItems="center" justifyContent="center" gap={8} style={{ padding: 40 }}>
        <ProgressCircle size="small" />
        <Text>Analyzing capacity impact…</Text>
      </Flex>
    );
  }

  if (status === "error") {
    return (
      <Flex alignItems="center" justifyContent="center" style={{ padding: 40 }}>
        <CriticalIcon style={{ color: CssTokens.feedbackCritical }} />
        <Text style={{ color: CssTokens.feedbackCritical, marginLeft: 8 }}>{error}</Text>
      </Flex>
    );
  }

  if (!analysis) {
    return (
      <Flex alignItems="center" justifyContent="center" style={{ padding: 40 }}>
        <Text style={{ color: CssTokens.textSecondary }}>No topology data available for impact analysis.</Text>
      </Flex>
    );
  }

  const {
    processCount, containerCount, serviceCount,
    callerCount, tier,
    totalInboundCalls, totalOutboundCalls,
    topCallers,
  } = analysis;

  return (
    <Flex flexDirection="column" gap={16}>
      {/* Row 1: Blast Radius + Dependency Priority */}
      <Flex gap={16} flexWrap="wrap">
        {/* 1. Blast Radius Summary */}
        <SectionCard title="Blast Radius" icon={<CriticalIcon style={{ color: CssTokens.feedbackCritical }} />}>
          <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>
            If <Text textStyle="small-emphasized">{hostName}</Text> hits capacity:
          </Text>
          <Flex gap={20} flexWrap="wrap">
            <Flex flexDirection="column" gap={2} alignItems="center" style={{ minWidth: 70, flex: "1 1 0" }}>
              <ContainerIcon style={{ color: CssTokens.textPrimary }} />
              <Text textStyle="base-emphasized">{processCount}</Text>
              <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>Processes</Text>
            </Flex>
            <Flex flexDirection="column" gap={2} alignItems="center" style={{ minWidth: 70, flex: "1 1 0" }}>
              <ContainerIcon style={{ color: CssTokens.textPrimary }} />
              <Text textStyle="base-emphasized">{containerCount}</Text>
              <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>Containers</Text>
            </Flex>
            <Flex flexDirection="column" gap={2} alignItems="center" style={{ minWidth: 70, flex: "1 1 0" }}>
              <ServicesIcon style={{ color: CssTokens.textPrimary }} />
              <Text textStyle="base-emphasized">{serviceCount}</Text>
              <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>Services</Text>
            </Flex>
            <Flex flexDirection="column" gap={2} alignItems="center" style={{ minWidth: 70, flex: "1 1 0" }}>
              <HostsIcon style={{ color: CssTokens.textPrimary }} />
              <Text textStyle="base-emphasized">{callerCount}</Text>
              <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>Upstream</Text>
            </Flex>
          </Flex>
          {totalInboundCalls > 0 && (
            <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>
              Serving <Text textStyle="small-emphasized">{totalInboundCalls.toLocaleString()}</Text> inbound
              {totalOutboundCalls > 0 && <> + <Text textStyle="small-emphasized">{totalOutboundCalls.toLocaleString()}</Text> outbound</>} calls
            </Text>
          )}
        </SectionCard>

        {/* 4. Dependency-Weighted Priority */}
        <SectionCard title="Dependency Priority" icon={
          tier.label.includes("Critical") ? <CriticalIcon style={{ color: tier.color }} /> :
          tier.label.includes("Important") ? <WarningIcon style={{ color: tier.color }} /> :
          <SuccessIcon style={{ color: tier.color }} />
        }>
          <Flex alignItems="center" gap={8}>
            <Text textStyle="base-emphasized" style={{ color: tier.color }}>{tier.label}</Text>
          </Flex>
          <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>
            {callerCount} upstream callers → recommended {tier.headroom}
          </Text>
          {topCallers.length > 0 ? (
            <Flex flexDirection="column" gap={4}>
              <Text textStyle="small-emphasized">Top callers by volume:</Text>
              {topCallers.map((c) => (
                <Flex key={c.id} alignItems="center" gap={8}>
                  <Text textStyle="small" style={{ color: CssTokens.textSecondary, minWidth: 60, textAlign: "right" }}>
                    {(c.callCount ?? 0).toLocaleString()}
                  </Text>
                  <ProgressBar
                    value={c.callPct ?? 0}
                    max={100}
                    style={{ flex: 1 }}
                  >
                    <ProgressBar.Label>{c.callPct ?? 0}%</ProgressBar.Label>
                  </ProgressBar>
                  <Text textStyle="small" style={{ color: CssTokens.textPrimary, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.name}
                  </Text>
                </Flex>
              ))}
            </Flex>
          ) : (
            <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>
              No significant call volume detected. Priority based on connection count only.
            </Text>
          )}
        </SectionCard>
      </Flex>

      {/* Row 2: Service Failover */}
      <Flex gap={16} flexWrap="wrap">
        {/* 2 + 5. Service-Aware Cascade Risk & Failover */}
        <SectionCard title="Service Failover Analysis" icon={<ServicesIcon style={{ color: CssTokens.feedbackWarning }} />}>
          {failoverStatus === "loading" ? (
            <Flex alignItems="center" gap={8}>
              <ProgressCircle size="small" />
              <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>Analyzing service dependencies…</Text>
            </Flex>
          ) : failover && failover.services.length > 0 ? (
            <Flex flexDirection="column" gap={8}>
              {/* Summary line */}
              <Flex gap={16} flexWrap="wrap">
                <Flex flexDirection="column" gap={2}>
                  <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>Services on host</Text>
                  <Text textStyle="base-emphasized">{failover.services.length}</Text>
                </Flex>
                <Flex flexDirection="column" gap={2}>
                  <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>Failover peers</Text>
                  <Text textStyle="base-emphasized">{failover.uniquePeerHosts.length}</Text>
                </Flex>
                {failover.singlePointServices.length > 0 && (
                  <Flex flexDirection="column" gap={2}>
                    <Text textStyle="small" style={{ color: CssTokens.feedbackCritical }}>Single point of failure</Text>
                    <Text textStyle="base-emphasized" style={{ color: CssTokens.feedbackCritical }}>{failover.singlePointServices.length}</Text>
                  </Flex>
                )}
              </Flex>

              {/* Single-point-of-failure services */}
              {failover.singlePointServices.length > 0 && (
                <Flex flexDirection="column" gap={4}>
                  <Flex alignItems="center" gap={6}>
                    <CriticalIcon style={{ color: CssTokens.feedbackCritical }} />
                    <Text textStyle="small-emphasized" style={{ color: CssTokens.feedbackCritical }}>
                      No failover for {failover.singlePointServices.length} service{failover.singlePointServices.length !== 1 ? "s" : ""}:
                    </Text>
                  </Flex>
                  {failover.singlePointServices.slice(0, 5).map((s) => (
                    <Flex key={s.serviceId} alignItems="center" gap={6} style={{ paddingLeft: 8 }}>
                      <ServicesIcon style={{ color: CssTokens.feedbackCritical, flexShrink: 0 }} />
                      <Text textStyle="small" style={{ color: CssTokens.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {s.serviceName}
                      </Text>
                    </Flex>
                  ))}
                  {failover.singlePointServices.length > 5 && (
                    <Text textStyle="small" style={{ color: CssTokens.textSecondary, paddingLeft: 8 }}>+{failover.singlePointServices.length - 5} more</Text>
                  )}
                </Flex>
              )}

              {/* Redundant services with peer hosts */}
              {failover.redundantServices.length > 0 && (
                <Flex flexDirection="column" gap={4}>
                  <Flex alignItems="center" gap={6}>
                    <SuccessIcon style={{ color: CssTokens.feedbackSuccess }} />
                    <Text textStyle="small-emphasized" style={{ color: CssTokens.feedbackSuccess }}>
                      {failover.redundantServices.length} service{failover.redundantServices.length !== 1 ? "s" : ""} with failover:
                    </Text>
                  </Flex>
                  {failover.redundantServices.slice(0, 5).map((s) => (
                    <Flex key={s.serviceId} alignItems="center" gap={6} style={{ paddingLeft: 8 }}>
                      <ServicesIcon style={{ color: CssTokens.feedbackSuccess, flexShrink: 0 }} />
                      <Flex flexDirection="column" style={{ minWidth: 0 }}>
                        <Text textStyle="small" style={{ color: CssTokens.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.serviceName}
                        </Text>
                        <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>
                          → {s.peerHosts.length} peer host{s.peerHosts.length !== 1 ? "s" : ""}: {s.peerHosts.slice(0, 3).map((h) => h.hostName).join(", ")}{s.peerHosts.length > 3 ? ` +${s.peerHosts.length - 3} more` : ""}
                        </Text>
                      </Flex>
                    </Flex>
                  ))}
                  {failover.redundantServices.length > 5 && (
                    <Text textStyle="small" style={{ color: CssTokens.textSecondary, paddingLeft: 8 }}>+{failover.redundantServices.length - 5} more</Text>
                  )}
                </Flex>
              )}
            </Flex>
          ) : (
            <Flex flexDirection="column" gap={4}>
              <Flex alignItems="center" gap={6}>
                <WarningIcon style={{ color: CssTokens.feedbackWarning }} />
                <Text textStyle="small-emphasized" style={{ color: CssTokens.feedbackWarning }}>
                  No application services detected
                </Text>
              </Flex>
              <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>
                This host has no detected application services. Failover analysis requires service-level topology.
              </Text>
            </Flex>
          )}
        </SectionCard>
      </Flex>
    </Flex>
  );
};
