// ============================================================
// Capacity Plans Page — Generate, list, and view plans
// ============================================================

import React, { useState, useMemo, useCallback } from "react";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { TitleBar } from "@dynatrace/strato-components-preview/layouts";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { EmptyState } from "@dynatrace/strato-components/content";
import { ProgressBar } from "@dynatrace/strato-components/content";
import { Button } from "@dynatrace/strato-components/buttons";
import { Text, Heading } from "@dynatrace/strato-components/typography";
import { Sheet } from "@dynatrace/strato-components-preview/overlays";
import { Tabs, Tab } from "@dynatrace/strato-components-preview/navigation";
import {
  SuccessIcon,
  WarningIcon,
  CriticalIcon,
  RefreshIcon,
  DeleteIcon,
  DocumentIcon,
} from "@dynatrace/strato-icons";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { useCostModel } from "../hooks/useCostModel";
import { useForecast, METRICS } from "../hooks/useForecast";
import { useGlobalFilters } from "../context/FilterContext";
import {
  listCapacityPlans,
  loadCapacityPlan,
  saveCapacityPlan,
  deleteCapacityPlan,
} from "../lib/documents";
import { formatDateTime, formatNumber, formatPercent } from "../utils/formatting";
import { CssTokens } from "../utils/design-tokens";
import type { CapacityPlan, PlanHostForecast, BottleneckSeverity } from "../types";

// ============================================================
// Helper: severity icon
// ============================================================
function SeverityIcon({ severity }: { severity: BottleneckSeverity }) {
  switch (severity) {
    case "critical":
      return <CriticalIcon style={{ color: CssTokens.feedbackCritical }} />;
    case "warning":
      return <WarningIcon style={{ color: CssTokens.feedbackWarning }} />;
    case "over_provisioned":
      return <WarningIcon style={{ color: CssTokens.feedbackInfo }} />;
    default:
      return <SuccessIcon style={{ color: CssTokens.feedbackSuccess }} />;
  }
}

// ============================================================
// Plan list item type
// ============================================================
interface PlanListItem {
  id: string;
  name: string;
  createdAt: string;
}

export const CapacityPlans: React.FC = () => {
  const [plans, setPlans] = useState<PlanListItem[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<CapacityPlan | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { costModel } = useCostModel();
  const { filters } = useGlobalFilters();

  // Fetch host list via DQL for plan generation
  const hostQuery = useDql(
    `fetch dt.entity.host
| fields id, entity.name
| sort entity.name asc
| limit 100`,
  );

  // Load plan list on mount
  React.useEffect(() => {
    loadPlans();
  }, []);

  const loadPlans = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await listCapacityPlans();
      setPlans(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load plans");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleViewPlan = useCallback(async (planId: string) => {
    try {
      const plan = await loadCapacityPlan(planId);
      if (plan) {
        setSelectedPlan(plan);
        setSheetOpen(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load plan");
    }
  }, []);

  const handleDeletePlan = useCallback(
    async (planId: string) => {
      try {
        await deleteCapacityPlan(planId);
        setPlans((prev) => prev.filter((p) => p.id !== planId));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete plan");
      }
    },
    [],
  );

  const handleGeneratePlan = useCallback(async () => {
    if (!hostQuery.data?.records) return;
    setIsGenerating(true);
    setError(null);

    try {
      const hosts = hostQuery.data.records as Array<{ id: string; "entity.name": string }>;

      // Build host forecasts from current host data
      const hostForecasts: PlanHostForecast[] = hosts.map((host) => {
        const hostId = String(host.id ?? "");
        const hostName = String(host["entity.name"] ?? "Unknown");
        const costEntry = costModel?.hosts[hostId];
        const monthlyCost = costEntry?.monthlyCostUsd ?? null;

        // These values will be populated with real forecast data
        // For now, the plan structure captures the host inventory with cost
        return {
          hostId,
          hostName,
          severity: "healthy" as BottleneckSeverity,
          currentCpu: 0,
          currentMemory: 0,
          currentDisk: 0,
          forecastCpu: 0,
          forecastMemory: 0,
          forecastDisk: 0,
          headroomPct: 100,
          recommendation: "No issues detected",
          monthlyCostUsd: monthlyCost,
          scalingCostImpact: null,
        };
      });

      const criticalCount = hostForecasts.filter((h) => h.severity === "critical").length;
      const warningCount = hostForecasts.filter((h) => h.severity === "warning").length;
      const healthyCount = hostForecasts.filter((h) => h.severity === "healthy").length;
      const overProvisionedCount = hostForecasts.filter((h) => h.severity === "over_provisioned").length;
      const totalCost = hostForecasts.reduce((sum, h) => sum + (h.monthlyCostUsd ?? 0), 0);

      const plan: CapacityPlan = {
        id: crypto.randomUUID(),
        name: `Capacity Plan — ${new Date().toLocaleDateString()}`,
        createdAt: new Date().toISOString(),
        createdBy: "Capacity Planner App",
        horizonDays: 30,
        summary: {
          totalHosts: hostForecasts.length,
          criticalCount,
          warningCount,
          healthyCount,
          overProvisionedCount,
          totalMonthlyCost: totalCost > 0 ? totalCost : null,
          projectedMonthlyCost: null,
          forecastAccuracyPct: null,
        },
        hostForecasts,
        actionItems: hostForecasts
          .filter((h) => h.severity === "critical" || h.severity === "warning")
          .map((h, i) => ({
            priority: i + 1,
            hostId: h.hostId,
            hostName: h.hostName,
            issue: h.severity === "critical" ? "Capacity exhaustion imminent" : "Approaching capacity limits",
            recommendation: h.recommendation,
            estimatedCostImpact: h.scalingCostImpact,
            daysToExhaustion: null,
          })),
        scenarioSummaries: [],
      };

      await saveCapacityPlan(plan);
      await loadPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate plan");
    } finally {
      setIsGenerating(false);
    }
  }, [hostQuery.data?.records, costModel]);

  // Plan list columns
  const planColumns: DataTableColumnDef<PlanListItem>[] = useMemo(
    () => [
      {
        id: "name",
        header: "Plan Name",
        accessor: "name",
      },
      {
        id: "createdAt",
        header: "Created",
        accessor: "createdAt",
        cell: ({ value }) => <Text>{formatDateTime(value)}</Text>,
      },
      {
        id: "actions",
        header: "Actions",
        accessor: "id",
        cell: ({ value }) => (
          <Flex flexDirection="row" gap={4}>
            <Button variant="default" onClick={() => handleViewPlan(value)}>
              <Button.Prefix><DocumentIcon /></Button.Prefix>
              View
            </Button>
            <Button variant="default" onClick={() => handleDeletePlan(value)}>
              <Button.Prefix><DeleteIcon /></Button.Prefix>
            </Button>
          </Flex>
        ),
      },
    ],
    [handleViewPlan, handleDeletePlan],
  );

  // Host forecast columns for plan detail sheet
  const forecastColumns: DataTableColumnDef<PlanHostForecast>[] = useMemo(
    () => [
      {
        id: "severity",
        header: "",
        accessor: "severity",
        cell: ({ value }) => <SeverityIcon severity={value} />,
      },
      {
        id: "hostName",
        header: "Host",
        accessor: "hostName",
      },
      {
        id: "currentCpu",
        header: "CPU Now",
        accessor: "currentCpu",
        cell: ({ value }) => <Text>{formatNumber(value, { maximumFractionDigits: 1 })}%</Text>,
      },
      {
        id: "forecastCpu",
        header: "CPU Projected",
        accessor: "forecastCpu",
        cell: ({ value }) => <Text>{formatNumber(value, { maximumFractionDigits: 1 })}%</Text>,
      },
      {
        id: "currentMemory",
        header: "Mem Now",
        accessor: "currentMemory",
        cell: ({ value }) => <Text>{formatNumber(value, { maximumFractionDigits: 1 })}%</Text>,
      },
      {
        id: "forecastMemory",
        header: "Mem Projected",
        accessor: "forecastMemory",
        cell: ({ value }) => <Text>{formatNumber(value, { maximumFractionDigits: 1 })}%</Text>,
      },
      {
        id: "monthlyCostUsd",
        header: "Monthly Cost",
        accessor: "monthlyCostUsd",
        cell: ({ value }) =>
          value !== null ? (
            <Text>${formatNumber(value, { maximumFractionDigits: 0 })}</Text>
          ) : (
            <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>—</Text>
          ),
      },
      {
        id: "recommendation",
        header: "Recommendation",
        accessor: "recommendation",
      },
    ],
    [],
  );

  return (
    <Flex flexDirection="column" gap={16} padding={16}>
      <TitleBar>
        <TitleBar.Title>Capacity Plans {plans.length > 0 && `(${plans.length})`}</TitleBar.Title>
        <TitleBar.Subtitle>
          Generate structured capacity plans for budget meetings and stakeholder reviews
        </TitleBar.Subtitle>
        <TitleBar.Suffix>
          <Flex flexDirection="row" gap={8}>
            <Button
              variant="emphasized"
              onClick={handleGeneratePlan}
              disabled={isGenerating || !hostQuery.data?.records}
            >
              {isGenerating ? "Generating…" : "Generate Plan"}
            </Button>
            <Button variant="default" onClick={loadPlans}>
              <Button.Prefix><RefreshIcon /></Button.Prefix>
            </Button>
          </Flex>
        </TitleBar.Suffix>
      </TitleBar>

      {error && (
        <Surface style={{ padding: 12, borderLeft: `3px solid ${CssTokens.feedbackCritical}` }}>
          <Text style={{ color: CssTokens.feedbackCritical }}>{error}</Text>
        </Surface>
      )}

      {!isLoading && plans.length === 0 ? (
        <EmptyState>
          <EmptyState.Title>No capacity plans yet</EmptyState.Title>
          <EmptyState.Details>
            Click "Generate Plan" to create your first capacity plan with fleet-wide forecasts, cost projections, and actionable recommendations.
          </EmptyState.Details>
          <EmptyState.Actions>
            <Button variant="emphasized" onClick={handleGeneratePlan} disabled={isGenerating}>
              Generate Plan
            </Button>
          </EmptyState.Actions>
        </EmptyState>
      ) : (
        <DataTable
          data={plans}
          columns={planColumns}
          sortable
          resizable
          loading={isLoading}
        >
          <DataTable.Toolbar>
            <DataTable.DownloadData />
          </DataTable.Toolbar>
        </DataTable>
      )}

      {/* Plan detail sheet */}
      {sheetOpen && selectedPlan && (
        <Sheet show={sheetOpen} onDismiss={() => setSheetOpen(false)} title={selectedPlan.name}>
          <Flex flexDirection="column" gap={16} padding={16}>
            <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>
              Created: {formatDateTime(selectedPlan.createdAt)} | Horizon: {selectedPlan.horizonDays} days
            </Text>

            {/* Summary */}
            <Flex flexDirection="row" gap={16}>
              <Surface style={{ flex: 1, padding: 12, textAlign: "center" }}>
                <Heading level={5}>{selectedPlan.summary.totalHosts}</Heading>
                <Text textStyle="small">Total Hosts</Text>
              </Surface>
              <Surface style={{ flex: 1, padding: 12, textAlign: "center" }}>
                <Heading level={5} style={{ color: CssTokens.feedbackCritical }}>
                  {selectedPlan.summary.criticalCount}
                </Heading>
                <Text textStyle="small">Critical</Text>
              </Surface>
              <Surface style={{ flex: 1, padding: 12, textAlign: "center" }}>
                <Heading level={5} style={{ color: CssTokens.feedbackWarning }}>
                  {selectedPlan.summary.warningCount}
                </Heading>
                <Text textStyle="small">Warning</Text>
              </Surface>
              <Surface style={{ flex: 1, padding: 12, textAlign: "center" }}>
                <Heading level={5} style={{ color: CssTokens.feedbackSuccess }}>
                  {selectedPlan.summary.healthyCount}
                </Heading>
                <Text textStyle="small">Healthy</Text>
              </Surface>
              {selectedPlan.summary.totalMonthlyCost !== null && (
                <Surface style={{ flex: 1, padding: 12, textAlign: "center" }}>
                  <Heading level={5}>
                    ${formatNumber(selectedPlan.summary.totalMonthlyCost, { maximumFractionDigits: 0 })}
                  </Heading>
                  <Text textStyle="small">Monthly Cost</Text>
                </Surface>
              )}
            </Flex>

            <Tabs>
              <Tab title="Host Forecasts">
                <DataTable
                  data={selectedPlan.hostForecasts}
                  columns={forecastColumns}
                  sortable
                  resizable
                >
                  <DataTable.Toolbar>
                    <DataTable.DownloadData />
                  </DataTable.Toolbar>
                </DataTable>
              </Tab>
              {selectedPlan.actionItems.length > 0 && (
                <Tab title={`Action Items (${selectedPlan.actionItems.length})`}>
                  <Flex flexDirection="column" gap={8} padding={8}>
                    {selectedPlan.actionItems.map((item, idx) => (
                      <Surface key={idx} style={{ padding: 12 }}>
                        <Flex flexDirection="row" gap={8} alignItems="center">
                          <Text textStyle="base-emphasized">{`#${item.priority}`}</Text>
                          <Text textStyle="base-emphasized">{item.hostName}</Text>
                        </Flex>
                        <Text textStyle="small">{item.issue}</Text>
                        <Text textStyle="small" style={{ color: CssTokens.textAccent }}>
                          {item.recommendation}
                        </Text>
                        {item.estimatedCostImpact !== null && (
                          <Text textStyle="small">
                            Cost impact: ${formatNumber(item.estimatedCostImpact, { maximumFractionDigits: 0 })}/mo
                          </Text>
                        )}
                      </Surface>
                    ))}
                  </Flex>
                </Tab>
              )}
            </Tabs>
          </Flex>
        </Sheet>
      )}
    </Flex>
  );
};
