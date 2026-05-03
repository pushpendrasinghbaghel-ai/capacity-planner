// ============================================================
// Scenario Builder — Define what-if simulation parameters
// ============================================================

import React, { useState, useMemo, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Flex, Surface, TitleBar } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Select } from "@dynatrace/strato-components/forms";
import { TextInput } from "@dynatrace/strato-components-preview/forms";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import {
  CriticalIcon,
} from "@dynatrace/strato-icons";
import { useSmartscapeTopology, ALL_NODE_TYPES } from "../hooks/useSmartscapeTopology";
import { useMetricsOverlay } from "../hooks/useMetricsOverlay";
import { useSimulation } from "../hooks/useSimulation";
import { useGlobalFilters, getTimeframeDqlClause } from "../context/FilterContext";
import { CssTokens } from "../utils/design-tokens";
import type { Scenario, ScenarioType, ScenarioParams } from "../types";

const SCENARIO_TYPES: Array<{ value: ScenarioType; label: string; description: string }> = [
  { value: "traffic_growth", label: "Traffic Growth", description: "Simulate Nx increase in request volume" },
  { value: "seasonal_spike", label: "Seasonal Spike", description: "Model temporary traffic surge (e.g., Black Friday)" },
  { value: "data_growth", label: "Data Growth", description: "Forecast storage and query volume growth" },
  { value: "database_scaling", label: "Database Scaling", description: "Model query and connection growth" },
  { value: "right_sizing", label: "Right-Sizing", description: "Identify over-provisioned resources to downsize" },
];

function createDefaultParams(type: ScenarioType): ScenarioParams {
  switch (type) {
    case "traffic_growth":
      return { type: "traffic_growth", multiplier: 2, rampUpDays: 0, pattern: "sustained" };
    case "seasonal_spike":
      return { type: "seasonal_spike", peakMultiplier: 3, durationHours: 24, label: "Spike" };
    case "data_growth":
      return { type: "data_growth", monthlyGrowthRate: 1.1, impactType: "both" };
    case "database_scaling":
      return { type: "database_scaling", queryMultiplier: 2, connectionMultiplier: 1.5 };
    case "right_sizing":
      return { type: "right_sizing", targetUtilizationRange: [60, 80], priority: "balanced" };
    default:
      return { type: "traffic_growth", multiplier: 2, rampUpDays: 0, pattern: "sustained" };
  }
}

export const ScenarioBuilder = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const entryPointFromUrl = searchParams.get("entryPoint") ?? "";

  const { filters } = useGlobalFilters();
  const timeframeDql = getTimeframeDqlClause(filters.timeframe);

  const { graph, status: topoStatus } = useSmartscapeTopology({
    timeframeDql,
    nodeTypes: ALL_NODE_TYPES,
  });
  useMetricsOverlay(graph, timeframeDql);
  const simulation = useSimulation(graph);

  const [scenarioName, setScenarioName] = useState("Scenario 1");
  const [scenarioType, setScenarioType] = useState<ScenarioType>("traffic_growth");
  const [entryPointId, setEntryPointId] = useState(entryPointFromUrl);
  const [multiplier, setMultiplier] = useState("2");
  const [horizonDays, setHorizonDays] = useState("90");

  // Available nodes for entry point selection
  const entryPointOptions = useMemo(() => {
    const options: Array<{ id: string; label: string }> = [];
    for (const node of graph.nodes.values()) {
      if (["SERVICE", "FRONTEND", "HOST", "K8S_DEPLOYMENT"].includes(node.type)) {
        options.push({ id: node.id, label: `${node.name} (${node.type})` });
      }
    }
    options.sort((a, b) => a.label.localeCompare(b.label));
    return options;
  }, [graph]);

  const entryPointNode = useMemo(
    () => graph.nodes.get(entryPointId),
    [graph, entryPointId]
  );

  const handleRunSimulation = useCallback(() => {
    if (!entryPointId) return;

    const params = createDefaultParams(scenarioType);
    // Override multiplier for applicable types
    if (params.type === "traffic_growth") {
      params.multiplier = parseFloat(multiplier) || 2;
    } else if (params.type === "seasonal_spike") {
      params.peakMultiplier = parseFloat(multiplier) || 3;
    } else if (params.type === "data_growth") {
      params.monthlyGrowthRate = parseFloat(multiplier) || 1.1;
    } else if (params.type === "database_scaling") {
      params.queryMultiplier = parseFloat(multiplier) || 2;
    }

    const scenario: Scenario = {
      id: `scenario-${Date.now()}`,
      name: scenarioName,
      type: scenarioType,
      entryPoints: [entryPointId],
      params,
      horizonDays: parseInt(horizonDays, 10) || 90,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    simulation.run(scenario);
  }, [entryPointId, scenarioName, scenarioType, multiplier, horizonDays, simulation]);

  // Auto-navigate to results when simulation completes
  React.useEffect(() => {
    if (simulation.status === "done" && simulation.result) {
      navigate("/results", { state: { simulationResult: simulation.result } });
    }
  }, [simulation.status, simulation.result, navigate]);

  const isReady = topoStatus === "success" && graph.nodes.size > 0;

  return (
    <Flex flexDirection="column" gap={0} style={{ height: "100%" }}>
      <TitleBar>
        <TitleBar.Title>Scenario Builder</TitleBar.Title>
        <TitleBar.Subtitle>
          Define a what-if scenario and simulate impact across the dependency graph
        </TitleBar.Subtitle>
      </TitleBar>

      <Flex flexDirection="column" padding={16} gap={24}>

      {/* Loading topology */}
      {topoStatus === "loading" && (
        <Flex alignItems="center" justifyContent="center" padding={48} gap={12}>
          <ProgressCircle />
          <Text>Loading topology…</Text>
        </Flex>
      )}

      {isReady && (
        <>
          {/* Scenario Config */}
          <Surface>
            <Flex flexDirection="column" padding={24} gap={20}>
              <Heading level={5}>Configuration</Heading>

              {/* Name */}
              <Flex flexDirection="column" gap={4}>
                <Text style={{ fontWeight: 600 }}>Scenario Name</Text>
                <TextInput
                  value={scenarioName}
                  onChange={setScenarioName}
                  placeholder="e.g., Black Friday 2x traffic"
                />
              </Flex>

              {/* Entry Point */}
              <Flex flexDirection="column" gap={4}>
                <Text style={{ fontWeight: 600 }}>Entry Point</Text>
                <Text style={{ color: CssTokens.textSecondary, fontSize: "var(--dt-sizes-font-size-100)" }}>
                  The node where the change originates. Impact cascades downstream through all dependencies.
                </Text>
                <Select value={entryPointId} onChange={(v) => setEntryPointId((v as string) ?? "")}>
                  <Select.Trigger placeholder="Select a service, host, or deployment…" style={{ minWidth: 400 }} />
                  <Select.Content>
                    {entryPointOptions.map((opt) => (
                      <Select.Option key={opt.id} value={opt.id}>{opt.label}</Select.Option>
                    ))}
                  </Select.Content>
                </Select>
                {entryPointNode && (
                  <Text style={{ color: CssTokens.textSecondary }}>
                    Selected: <strong>{entryPointNode.name}</strong> ({entryPointNode.type}),{" "}
                    {(graph.adjacency.get(entryPointId) ?? []).length} downstream dependencies
                  </Text>
                )}
              </Flex>

              {/* Scenario Type */}
              <Flex flexDirection="column" gap={4}>
                <Text style={{ fontWeight: 600 }}>Scenario Type</Text>
                <Select value={scenarioType} onChange={(v) => setScenarioType((v as ScenarioType) ?? "traffic_growth")}>
                  <Select.Trigger style={{ minWidth: 300 }} />
                  <Select.Content>
                    {SCENARIO_TYPES.map((st) => (
                      <Select.Option key={st.value} value={st.value}>{st.label}</Select.Option>
                    ))}
                  </Select.Content>
                </Select>
                <Text style={{ color: CssTokens.textSecondary, fontSize: "var(--dt-sizes-font-size-100)" }}>
                  {SCENARIO_TYPES.find((s) => s.value === scenarioType)?.description}
                </Text>
              </Flex>

              {/* Multiplier */}
              <Flex gap={24}>
                <Flex flexDirection="column" gap={4} style={{ flex: 1 }}>
                  <Text style={{ fontWeight: 600 }}>
                    {scenarioType === "data_growth" ? "Monthly Growth Rate" : "Multiplier"}
                  </Text>
                  <TextInput
                    value={multiplier}
                    onChange={setMultiplier}
                    placeholder={scenarioType === "data_growth" ? "1.1 = 10% monthly" : "2 = double traffic"}
                  />
                  <Text style={{ color: CssTokens.textSecondary, fontSize: "var(--dt-sizes-font-size-100)" }}>
                    {scenarioType === "data_growth"
                      ? "1.1 = 10% monthly growth, 1.5 = 50% monthly growth"
                      : `${multiplier}x = ${((parseFloat(multiplier) || 1) * 100 - 100).toFixed(0)}% increase`}
                  </Text>
                </Flex>

                <Flex flexDirection="column" gap={4} style={{ flex: 1 }}>
                  <Text style={{ fontWeight: 600 }}>Forecast Horizon (days)</Text>
                  <TextInput
                    value={horizonDays}
                    onChange={setHorizonDays}
                    placeholder="90"
                  />
                </Flex>
              </Flex>
            </Flex>
          </Surface>

          {/* Run button */}
          <Flex gap={16} alignItems="center">
            <Button
              variant="emphasized"
              onClick={handleRunSimulation}
              disabled={!entryPointId || simulation.status === "running" || parseFloat(multiplier) <= 0}
            >
              {simulation.status === "running" ? "Simulating…" : "Run Simulation"}
            </Button>
            {simulation.status === "running" && <ProgressCircle size="small" />}
            <Button variant="default" onClick={() => navigate("/")}>
              Back to Topology
            </Button>
          </Flex>

          {/* Error */}
          {simulation.error && (
            <Surface>
              <Flex padding={16} gap={8}>
                <CriticalIcon style={{ color: CssTokens.feedbackCritical }} />
                <Text style={{ color: CssTokens.feedbackCritical }}>{simulation.error}</Text>
              </Flex>
            </Surface>
          )}
        </>
      )}
      </Flex>
    </Flex>
  );
};
