// ============================================================
// Scenario Comparison Page — Side-by-side simulation comparison
// ============================================================

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { TitleBar } from "@dynatrace/strato-components-preview/layouts";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { EmptyState } from "@dynatrace/strato-components/content";
import { ProgressBar } from "@dynatrace/strato-components/content";
import { Button } from "@dynatrace/strato-components/buttons";
import { Text, Heading } from "@dynatrace/strato-components/typography";
import { Select } from "@dynatrace/strato-components-preview/forms";
import {
  SuccessIcon,
  WarningIcon,
  CriticalIcon,
  RefreshIcon,
} from "@dynatrace/strato-icons";
import {
  listSavedSimulations,
  loadSimulation,
} from "../lib/documents";
import { formatDateTime, formatNumber } from "../utils/formatting";
import { CssTokens } from "../utils/design-tokens";
import type { SavedSimulation, NodeSimulationResult, BottleneckSeverity } from "../types";

// ============================================================
// Types
// ============================================================
interface SimulationListItem {
  id: string;
  name: string;
  savedAt: string;
  scenarioType: string;
}

interface ComparisonRow {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  scenarioA_projected: number | null;
  scenarioA_severity: BottleneckSeverity | null;
  scenarioA_headroom: number | null;
  scenarioB_projected: number | null;
  scenarioB_severity: BottleneckSeverity | null;
  scenarioB_headroom: number | null;
  delta: number | null;
}

function SeverityBadge({ severity }: { severity: BottleneckSeverity | null }) {
  if (!severity) return <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>—</Text>;
  switch (severity) {
    case "critical":
      return <CriticalIcon style={{ color: CssTokens.feedbackCritical }} />;
    case "warning":
      return <WarningIcon style={{ color: CssTokens.feedbackWarning }} />;
    default:
      return <SuccessIcon style={{ color: CssTokens.feedbackSuccess }} />;
  }
}

export const ScenarioComparison: React.FC = () => {
  const [simulations, setSimulations] = useState<SimulationListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [scenarioAId, setScenarioAId] = useState<string | null>(null);
  const [scenarioBId, setScenarioBId] = useState<string | null>(null);
  const [scenarioA, setScenarioA] = useState<SavedSimulation | null>(null);
  const [scenarioB, setScenarioB] = useState<SavedSimulation | null>(null);
  const [loadingComparison, setLoadingComparison] = useState(false);

  useEffect(() => {
    loadSimulations();
  }, []);

  const loadSimulations = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await listSavedSimulations();
      setSimulations(list);
    } catch {
      // silently fail
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleCompare = useCallback(async () => {
    if (!scenarioAId || !scenarioBId) return;
    setLoadingComparison(true);
    try {
      const [a, b] = await Promise.all([
        loadSimulation(scenarioAId),
        loadSimulation(scenarioBId),
      ]);
      setScenarioA(a);
      setScenarioB(b);
    } catch {
      // silently fail
    } finally {
      setLoadingComparison(false);
    }
  }, [scenarioAId, scenarioBId]);

  // Build comparison rows by merging nodeResults from both scenarios
  const comparisonRows: ComparisonRow[] = useMemo(() => {
    if (!scenarioA || !scenarioB) return [];

    const nodeMap = new Map<string, ComparisonRow>();

    // Fill scenario A
    for (const node of scenarioA.result.nodeResults) {
      nodeMap.set(node.nodeId, {
        nodeId: node.nodeId,
        nodeName: node.nodeName,
        nodeType: node.nodeType,
        scenarioA_projected: node.projectedUtilization,
        scenarioA_severity: node.severity,
        scenarioA_headroom: node.headroomPct,
        scenarioB_projected: null,
        scenarioB_severity: null,
        scenarioB_headroom: null,
        delta: null,
      });
    }

    // Merge scenario B
    for (const node of scenarioB.result.nodeResults) {
      const existing = nodeMap.get(node.nodeId);
      if (existing) {
        existing.scenarioB_projected = node.projectedUtilization;
        existing.scenarioB_severity = node.severity;
        existing.scenarioB_headroom = node.headroomPct;
        existing.delta =
          existing.scenarioA_projected !== null
            ? node.projectedUtilization - existing.scenarioA_projected
            : null;
      } else {
        nodeMap.set(node.nodeId, {
          nodeId: node.nodeId,
          nodeName: node.nodeName,
          nodeType: node.nodeType,
          scenarioA_projected: null,
          scenarioA_severity: null,
          scenarioA_headroom: null,
          scenarioB_projected: node.projectedUtilization,
          scenarioB_severity: node.severity,
          scenarioB_headroom: node.headroomPct,
          delta: null,
        });
      }
    }

    return Array.from(nodeMap.values()).sort((a, b) => {
      // Sort by absolute delta descending (biggest differences first)
      const aDelta = Math.abs(a.delta ?? 0);
      const bDelta = Math.abs(b.delta ?? 0);
      return bDelta - aDelta;
    });
  }, [scenarioA, scenarioB]);

  const columns: DataTableColumnDef<ComparisonRow>[] = useMemo(
    () => [
      { id: "nodeName", header: "Node", accessor: "nodeName" },
      { id: "nodeType", header: "Type", accessor: "nodeType" },
      {
        id: "scenarioA_severity",
        header: "A Status",
        accessor: "scenarioA_severity",
        cell: ({ value }) => <SeverityBadge severity={value} />,
      },
      {
        id: "scenarioA_projected",
        header: "A Utilization",
        accessor: "scenarioA_projected",
        cell: ({ value }) =>
          value !== null ? (
            <Text>{formatNumber(value, { maximumFractionDigits: 1 })}%</Text>
          ) : (
            <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>—</Text>
          ),
      },
      {
        id: "scenarioB_severity",
        header: "B Status",
        accessor: "scenarioB_severity",
        cell: ({ value }) => <SeverityBadge severity={value} />,
      },
      {
        id: "scenarioB_projected",
        header: "B Utilization",
        accessor: "scenarioB_projected",
        cell: ({ value }) =>
          value !== null ? (
            <Text>{formatNumber(value, { maximumFractionDigits: 1 })}%</Text>
          ) : (
            <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>—</Text>
          ),
      },
      {
        id: "delta",
        header: "Delta",
        accessor: "delta",
        cell: ({ value }) => {
          if (value === null) {
            return <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>—</Text>;
          }
          const color =
            value > 5
              ? CssTokens.feedbackCritical
              : value < -5
                ? CssTokens.feedbackSuccess
                : CssTokens.textPrimary;
          const prefix = value > 0 ? "+" : "";
          return (
            <Text style={{ color }}>
              {prefix}{formatNumber(value, { maximumFractionDigits: 1 })}%
            </Text>
          );
        },
      },
    ],
    [],
  );

  // Cost delta summary
  const costDelta = useMemo(() => {
    if (!scenarioA || !scenarioB) return null;
    const aCost = scenarioA.costSummary.projectedMonthlyCost;
    const bCost = scenarioB.costSummary.projectedMonthlyCost;
    if (aCost === null || bCost === null) return null;
    return bCost - aCost;
  }, [scenarioA, scenarioB]);

  if (!isLoading && simulations.length < 2) {
    return (
      <Flex flexDirection="column" gap={16} padding={16}>
        <TitleBar>
          <TitleBar.Title>Scenario Comparison</TitleBar.Title>
        </TitleBar>
        <EmptyState>
          <EmptyState.Title>Need at least 2 saved simulations</EmptyState.Title>
          <EmptyState.Details>
            Run simulations from the Scenario Builder page and save them to enable side-by-side comparison.
            You currently have {simulations.length} saved simulation(s).
          </EmptyState.Details>
        </EmptyState>
      </Flex>
    );
  }

  return (
    <Flex flexDirection="column" gap={16} padding={16}>
      <TitleBar>
        <TitleBar.Title>Scenario Comparison</TitleBar.Title>
        <TitleBar.Subtitle>
          Compare two simulations side by side to evaluate capacity trade-offs
        </TitleBar.Subtitle>
        <TitleBar.Suffix>
          <Button variant="default" onClick={loadSimulations}>
            <Button.Prefix><RefreshIcon /></Button.Prefix>
          </Button>
        </TitleBar.Suffix>
      </TitleBar>

      {/* Scenario Selectors */}
      <Flex flexDirection="row" gap={16} alignItems="flex-end">
        <div style={{ flex: 1 }}>
          <Select
            name="scenarioA"
            onChange={(val) => setScenarioAId(val as string)}
          >
            <Select.Trigger placeholder="Select Scenario A" />
            <Select.Content>
              {simulations.map((s) => (
                <Select.Option key={s.id} value={s.id}>
                  {s.name} ({formatDateTime(s.savedAt)})
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </div>
        <div style={{ flex: 1 }}>
          <Select
            name="scenarioB"
            onChange={(val) => setScenarioBId(val as string)}
          >
            <Select.Trigger placeholder="Select Scenario B" />
            <Select.Content>
              {simulations.map((s) => (
                <Select.Option key={s.id} value={s.id}>
                  {s.name} ({formatDateTime(s.savedAt)})
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </div>
        <Button
          variant="emphasized"
          onClick={handleCompare}
          disabled={!scenarioAId || !scenarioBId || scenarioAId === scenarioBId || loadingComparison}
        >
          {loadingComparison ? "Loading…" : "Compare"}
        </Button>
      </Flex>

      {/* Comparison Results */}
      {scenarioA && scenarioB && (
        <>
          {/* Summary Banner */}
          <Flex flexDirection="row" gap={16}>
            <Surface style={{ flex: 1, padding: 16 }}>
              <Heading level={5}>{scenarioA.scenarioName}</Heading>
              <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>
                {scenarioA.result.bottlenecks.length} bottleneck(s) |{" "}
                {scenarioA.result.nodesAnalyzed} nodes analyzed
              </Text>
              {scenarioA.costSummary.projectedMonthlyCost !== null && (
                <Text textStyle="base-emphasized">
                  ${formatNumber(scenarioA.costSummary.projectedMonthlyCost, { maximumFractionDigits: 0 })}/mo
                </Text>
              )}
            </Surface>
            <Surface style={{ flex: "0 0 auto", padding: 16, textAlign: "center" }}>
              <Heading level={5}>Delta</Heading>
              {costDelta !== null ? (
                <Text
                  textStyle="base-emphasized"
                  style={{
                    color: costDelta > 0 ? CssTokens.feedbackCritical : CssTokens.feedbackSuccess,
                  }}
                >
                  {costDelta > 0 ? "+" : ""}${formatNumber(costDelta, { maximumFractionDigits: 0 })}/mo
                </Text>
              ) : (
                <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>No cost data</Text>
              )}
            </Surface>
            <Surface style={{ flex: 1, padding: 16 }}>
              <Heading level={5}>{scenarioB.scenarioName}</Heading>
              <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>
                {scenarioB.result.bottlenecks.length} bottleneck(s) |{" "}
                {scenarioB.result.nodesAnalyzed} nodes analyzed
              </Text>
              {scenarioB.costSummary.projectedMonthlyCost !== null && (
                <Text textStyle="base-emphasized">
                  ${formatNumber(scenarioB.costSummary.projectedMonthlyCost, { maximumFractionDigits: 0 })}/mo
                </Text>
              )}
            </Surface>
          </Flex>

          {/* Node-by-node comparison table */}
          <DataTable
            data={comparisonRows}
            columns={columns}
            sortable
            resizable
          >
            <DataTable.Toolbar>
              <DataTable.DownloadData />
            </DataTable.Toolbar>
          </DataTable>
        </>
      )}
    </Flex>
  );
};
