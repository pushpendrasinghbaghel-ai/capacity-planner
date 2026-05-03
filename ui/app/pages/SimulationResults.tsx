// ============================================================
// Simulation Results — Cascade analysis, bottlenecks, critical path
// ============================================================

import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Flex, Surface, TitleBar } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { DataTable, TableActionsMenu, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { EmptyState } from "@dynatrace/strato-components/content";
import { Button } from "@dynatrace/strato-components/buttons";
import {
  CriticalIcon,
  WarningIcon,
  SuccessIcon,
  CheckmarkIcon,
} from "@dynatrace/strato-icons";
import { CssTokens } from "../utils/design-tokens";
import { formatPercent } from "../utils/formatting";
import type { SimulationResult, NodeSimulationResult, BottleneckSeverity } from "../types";

const SEVERITY_BADGE: Record<BottleneckSeverity, { icon: React.ReactNode; color: string; label: string }> = {
  critical: { icon: <CriticalIcon />, color: CssTokens.feedbackCritical, label: "CRITICAL" },
  warning: { icon: <WarningIcon />, color: CssTokens.feedbackWarning, label: "WARNING" },
  healthy: { icon: <SuccessIcon />, color: CssTokens.feedbackSuccess, label: "HEALTHY" },
  over_provisioned: { icon: <CheckmarkIcon />, color: CssTokens.feedbackInfo, label: "OVER-PROVISIONED" },
};

export const SimulationResults = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const result = (location.state as { simulationResult?: SimulationResult })?.simulationResult;

  if (!result) {
    return (
      <EmptyState>
        <EmptyState.Title>No simulation results</EmptyState.Title>
        <EmptyState.Details>
          Run a simulation from the Scenario Builder first.
        </EmptyState.Details>
        <EmptyState.Actions>
          <Button variant="emphasized" onClick={() => navigate("/scenario")}>
            Go to Scenario Builder
          </Button>
        </EmptyState.Actions>
      </EmptyState>
    );
  }

  const criticalCount = result.bottlenecks.filter((n) => n.severity === "critical").length;
  const warningCount = result.bottlenecks.filter((n) => n.severity === "warning").length;
  const overProvCount = result.bottlenecks.filter((n) => n.severity === "over_provisioned").length;
  const healthyCount = result.bottlenecks.filter((n) => n.severity === "healthy").length;

  return (
    <Flex flexDirection="column" gap={0} style={{ height: "100%" }}>
      {/* ── TitleBar ── */}
      <TitleBar>
        <TitleBar.Title>
          Simulation Results
        </TitleBar.Title>
        <TitleBar.Subtitle>
          Scenario: {result.scenarioName} — {result.nodesAnalyzed} nodes analyzed
        </TitleBar.Subtitle>
      </TitleBar>

      <Flex flexDirection="column" padding={16} gap={24}>

      {/* Summary cards */}
      <Flex gap={16} flexWrap="wrap">
        <SummaryCard label="Critical" count={criticalCount} color={CssTokens.feedbackCritical} icon={<CriticalIcon />} />
        <SummaryCard label="Warning" count={warningCount} color={CssTokens.feedbackWarning} icon={<WarningIcon />} />
        <SummaryCard label="Healthy" count={healthyCount} color={CssTokens.feedbackSuccess} icon={<SuccessIcon />} />
        <SummaryCard label="Over-provisioned" count={overProvCount} color={CssTokens.feedbackInfo} icon={<CheckmarkIcon />} />
      </Flex>

      {/* Critical Path */}
      {result.criticalPath.length > 0 && (
        <Surface>
          <Flex flexDirection="column" padding={16} gap={8}>
            <Heading level={5}>Critical Path</Heading>
            <Text style={{ color: CssTokens.textSecondary }}>
              The dependency chain from entry point to the first bottleneck:
            </Text>
            <Flex gap={8} alignItems="center" flexWrap="wrap">
              {result.criticalPath.map((nodeId, idx) => {
                const nodeResult = result.nodeResults.find((n) => n.nodeId === nodeId);
                const badge = nodeResult ? SEVERITY_BADGE[nodeResult.severity] : SEVERITY_BADGE.healthy;
                return (
                  <React.Fragment key={nodeId}>
                    {idx > 0 && <Text style={{ color: CssTokens.textSecondary, fontSize: "1.2em" }}>→</Text>}
                    <Flex
                      alignItems="center"
                      gap={4}
                      style={{
                        padding: "4px 12px",
                        borderRadius: "var(--dt-sizes-border-radius-200)",
                        border: `1px solid ${badge.color}`,
                        background: "var(--dt-colors-background-surface-default)",
                      }}
                    >
                      <span style={{ color: badge.color }}>{badge.icon}</span>
                      <Text style={{ fontWeight: 500, fontSize: "var(--dt-sizes-font-size-100)" }}>
                        {nodeResult?.nodeName ?? nodeId}
                      </Text>
                      {nodeResult && (
                        <Text style={{ color: badge.color, fontWeight: 600, fontSize: "var(--dt-sizes-font-size-100)" }}>
                          {formatPercent(nodeResult.projectedUtilization)}
                        </Text>
                      )}
                    </Flex>
                  </React.Fragment>
                );
              })}
            </Flex>
          </Flex>
        </Surface>
      )}

      {/* Bottleneck Table */}
      <Surface>
        <Flex flexDirection="column" padding={16} gap={8}>
          <Heading level={5}>All Nodes — Impact Analysis</Heading>
          <DataTable
            data={result.bottlenecks}
            resizable
            sortable
            fullWidth
            columnOrdering
            columns={[
              { id: "severity", header: "", accessor: "severity", width: 40, cell: ({ rowData }) => {
                const cfg = SEVERITY_BADGE[rowData.severity];
                return <span style={{ color: cfg.color }}>{cfg.icon}</span>;
              }},
              { id: "nodeName", header: "Name", accessor: "nodeName" },
              { id: "nodeType", header: "Type", accessor: "nodeType", width: 130 },
              { id: "effectiveMultiplier", header: "Multiplier", accessor: "effectiveMultiplier", width: 100, cell: ({ value }) => (
                <Text style={{ fontWeight: 600 }}>{(value as number).toFixed(2)}x</Text>
              )},
              { id: "currentUtilization", header: "Current", accessor: "currentUtilization", width: 90, cell: ({ value }) => (
                <>{formatPercent(value as number)}</>
              )},
              { id: "projectedUtilization", header: "Projected", accessor: "projectedUtilization", width: 100, cell: ({ value, rowData }) => {
                const cfg = SEVERITY_BADGE[rowData.severity];
                return <Text style={{ fontWeight: 600, color: cfg.color }}>{formatPercent(value as number)}</Text>;
              }},
              { id: "headroomPct", header: "Headroom", accessor: "headroomPct", width: 90, cell: ({ value }) => (
                <>{formatPercent(value as number)}</>
              )},
              { id: "daysToExhaustion", header: "Days to Full", accessor: "daysToExhaustion", width: 110, cell: ({ value }) => {
                const days = value as number | null;
                return <Text style={{
                  fontWeight: 600,
                  color: days !== null && days < 30 ? CssTokens.feedbackCritical
                    : days !== null && days < 90 ? CssTokens.feedbackWarning
                    : CssTokens.textPrimary,
                }}>{days !== null ? `${days}d` : "—"}</Text>;
              }},
              { id: "recommendation", header: "Recommendation", accessor: "recommendation", cell: ({ value }) => (
                <Text style={{ fontSize: "var(--dt-sizes-font-size-100)" }}>{value as string}</Text>
              )},
            ] as DataTableColumnDef<NodeSimulationResult>[]}
          >
            <DataTable.Toolbar>
              <DataTable.LineWrap />
              <DataTable.ColumnOrderSettings />
              <DataTable.DownloadData />
            </DataTable.Toolbar>
          </DataTable>
        </Flex>
      </Surface>

      {/* Actions */}
      <Flex gap={16}>
        <Button variant="emphasized" onClick={() => navigate("/scenario")}>
          New Simulation
        </Button>
        <Button variant="default" onClick={() => navigate("/")}>
          Back to Topology
        </Button>
      </Flex>
      </Flex>
    </Flex>
  );
};

// ---- Internal Components ----

const SummaryCard: React.FC<{
  label: string;
  count: number;
  color: string;
  icon: React.ReactNode;
}> = ({ label, count, color, icon }) => (
  <Surface style={{ flex: "1 1 180px", minWidth: 180 }}>
    <Flex flexDirection="column" alignItems="center" padding={20} gap={8}>
      <span style={{ color, fontSize: "1.5em" }}>{icon}</span>
      <Text style={{ fontSize: "var(--dt-sizes-font-size-400)", fontWeight: 700, color }}>
        {count}
      </Text>
      <Text style={{ fontWeight: 600 }}>{label}</Text>
    </Flex>
  </Surface>
);
