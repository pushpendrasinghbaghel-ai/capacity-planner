// ============================================================
// Capacity Library — Headroom, bottleneck, and severity logic
// ============================================================

import type {
  TopologyGraph,
  TopologyNode,
  NodeSimulationResult,
  SimulationResult,
  BottleneckSeverity,
} from "../types";
import type { PropagationResult } from "./graph";

// ---- Severity Classification ----

/** Classify node severity based on projected utilization */
export function classifySeverity(
  projectedUtilizationPct: number,
  warningThreshold: number = 70,
  criticalThreshold: number = 85
): BottleneckSeverity {
  if (projectedUtilizationPct >= criticalThreshold) return "critical";
  if (projectedUtilizationPct >= warningThreshold) return "warning";
  if (projectedUtilizationPct < 30) return "over_provisioned";
  return "healthy";
}

/** Get recommendation text for a severity */
export function getRecommendationText(
  severity: BottleneckSeverity,
  nodeType: string,
  projectedPct: number,
  canScaleHorizontally: boolean
): string {
  switch (severity) {
    case "critical":
      return canScaleHorizontally
        ? `SCALE OUT — projected ${projectedPct.toFixed(1)}% exceeds critical threshold. Add ${nodeType.toLowerCase()} instances immediately.`
        : `SCALE UP — projected ${projectedPct.toFixed(1)}% exceeds critical threshold. Increase ${nodeType.toLowerCase()} capacity.`;
    case "warning":
      return `MONITOR — projected ${projectedPct.toFixed(1)}% approaching limits. Plan scaling within procurement lead time.`;
    case "over_provisioned":
      return `RIGHT-SIZE — ${projectedPct.toFixed(1)}% utilization. Consider downsizing to reduce cost.`;
    case "healthy":
      return `STABLE — ${projectedPct.toFixed(1)}% utilization is within healthy range.`;
  }
}

// ---- Headroom Calculation ----

/** Calculate headroom percentage for a single metric */
export function computeHeadroom(
  currentValue: number,
  limit: number
): number {
  if (limit <= 0) return 0;
  return Math.max(0, ((limit - currentValue) / limit) * 100);
}

/** Get the primary utilization % for a node (best metric available) */
export function getNodeUtilization(node: TopologyNode): number {
  // For hosts/instances: use CPU as primary indicator
  if (node.metrics.cpuAvg !== undefined) return node.metrics.cpuAvg;
  // For services: approximate based on response time vs baseline
  if (node.metrics.requestRate !== undefined && node.limits.maxRequestRate) {
    return (node.metrics.requestRate / node.limits.maxRequestRate) * 100;
  }
  return 0;
}

/** Get the constraint metric names for a node */
export function getConstraintMetrics(node: TopologyNode): string[] {
  const constraints: string[] = [];

  if (node.metrics.cpuAvg !== undefined && node.metrics.cpuAvg >= node.limits.maxCpuPct * 0.7) {
    constraints.push("CPU");
  }
  if (node.metrics.memoryAvg !== undefined && node.metrics.memoryAvg >= node.limits.maxMemoryPct * 0.7) {
    constraints.push("Memory");
  }
  if (node.metrics.diskUsedPct !== undefined && node.metrics.diskUsedPct >= node.limits.maxDiskPct * 0.7) {
    constraints.push("Disk");
  }
  if (
    node.metrics.requestRate !== undefined &&
    node.limits.maxRequestRate !== undefined &&
    node.metrics.requestRate >= node.limits.maxRequestRate * 0.7
  ) {
    constraints.push("Request Rate");
  }

  return constraints;
}

// ---- Simulation ----

/** Run a simulation: given propagation results, compute per-node impact */
export function computeSimulation(
  graph: TopologyGraph,
  propagation: PropagationResult,
  scenarioId: string,
  scenarioName: string
): SimulationResult {
  const nodeResults: NodeSimulationResult[] = [];

  for (const nodeId of propagation.visitOrder) {
    const node = graph.nodes.get(nodeId);
    if (!node) continue;

    const multiplier = propagation.multipliers.get(nodeId) ?? 1;
    const currentUtil = getNodeUtilization(node);
    const projectedUtil = Math.min(currentUtil * multiplier, 100);
    const headroom = computeHeadroom(projectedUtil, 100);
    const severity = classifySeverity(projectedUtil);
    const constraintMetrics = getConstraintMetrics(node);

    // Estimate days to exhaustion based on linear growth to projected
    const daysToExhaustion = projectedUtil >= 85
      ? estimateDaysToExhaustion(currentUtil, projectedUtil, 90)
      : null;

    nodeResults.push({
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      effectiveMultiplier: multiplier,
      currentUtilization: currentUtil,
      projectedUtilization: projectedUtil,
      headroomPct: headroom,
      severity,
      recommendation: getRecommendationText(
        severity,
        node.type,
        projectedUtil,
        node.limits.canScaleHorizontally
      ),
      daysToExhaustion,
      constraintMetrics,
    });
  }

  // Sort bottlenecks: critical first, then warning, then by projected util desc
  const severityOrder: Record<BottleneckSeverity, number> = {
    critical: 0,
    warning: 1,
    over_provisioned: 2,
    healthy: 3,
  };

  const bottlenecks = [...nodeResults].sort((a, b) => {
    const sDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sDiff !== 0) return sDiff;
    return b.projectedUtilization - a.projectedUtilization;
  });

  // Critical path: path to first critical/warning bottleneck
  const firstBottleneck = bottlenecks.find(
    (n) => n.severity === "critical" || n.severity === "warning"
  );
  const criticalPath = firstBottleneck
    ? propagation.paths.get(firstBottleneck.nodeId) ?? []
    : [];

  return {
    scenarioId,
    scenarioName,
    nodeResults,
    bottlenecks,
    criticalPath,
    nodesAnalyzed: nodeResults.length,
    timestamp: new Date().toISOString(),
  };
}

// ---- Helpers ----

/**
 * Crude estimate of days to exhaustion.
 * Assumes linear growth from current to projected over 90 days (default horizon).
 */
function estimateDaysToExhaustion(
  currentPct: number,
  projectedPct: number,
  horizonDays: number
): number | null {
  if (projectedPct <= currentPct) return null;
  const ratePerDay = (projectedPct - currentPct) / horizonDays;
  if (ratePerDay <= 0) return null;
  const remaining = 100 - currentPct;
  return Math.round(remaining / ratePerDay);
}
