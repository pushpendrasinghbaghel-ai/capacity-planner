// ============================================================
// Topology Explorer — Visual Smartscape topology + capacity planning
// Strato-native filter bar, timeframe, node-type segments, skeleton loading
// ============================================================

import React, { useState, useMemo, useCallback } from "react";
import { Flex, Surface, TitleBar } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Skeleton, SkeletonText, EmptyState } from "@dynatrace/strato-components/content";
import {
  TimeframeSelector,
} from "@dynatrace/strato-components/filters";
import { Select } from "@dynatrace/strato-components/forms";
import type { Timeframe } from "@dynatrace/strato-components/core";
import {
  CriticalIcon,
  RefreshIcon,
} from "@dynatrace/strato-icons";
import { useSmartscapeTopology } from "../hooks/useSmartscapeTopology";
import { useMetricsOverlay } from "../hooks/useMetricsOverlay";
import { useCapacityReport } from "../hooks/useCapacityReport";
import { TopologyGraphView } from "../components/TopologyGraph";
import { CapacityReport } from "../components/CapacityReport";
import { useGlobalFilters, getTimeframeDqlClause, createDefaultTimeframe } from "../context/FilterContext";
import { graphStats } from "../lib/graph";
import { CssTokens } from "../utils/design-tokens";
import { formatNumber } from "../utils/formatting";
import type { TopologyNode, SmartscapeNodeType } from "../types";

const NODE_TYPE_OPTIONS: Array<{ id: SmartscapeNodeType; label: string }> = [
  { id: "HOST", label: "Hosts" },
  { id: "SERVICE", label: "Services" },
  { id: "PROCESS", label: "Processes" },
  { id: "FRONTEND", label: "Frontends" },
  { id: "K8S_CLUSTER", label: "K8s Clusters" },
  { id: "K8S_NODE", label: "K8s Nodes" },
  { id: "K8S_POD", label: "K8s Pods" },
  { id: "K8S_NAMESPACE", label: "K8s Namespaces" },
  { id: "K8S_DEPLOYMENT", label: "K8s Deployments" },
];

const DEFAULT_SELECTED_TYPES: SmartscapeNodeType[] = ["HOST", "SERVICE", "PROCESS", "FRONTEND"];
const MAX_NODES_OPTIONS = [
  { value: 200, label: "200 nodes" },
  { value: 500, label: "500 nodes" },
  { value: 1000, label: "1,000 nodes" },
  { value: 2000, label: "2,000 nodes" },
];

export const TopologyExplorer = () => {
  // Global filter context
  const { filters, updateFilter } = useGlobalFilters();

  // Local filter state
  const [selectedTypes, setSelectedTypes] = useState<SmartscapeNodeType[]>(DEFAULT_SELECTED_TYPES);
  const [maxNodes, setMaxNodes] = useState<number>(500);

  // Derived DQL timeframe
  const timeframeDql = useMemo(
    () => getTimeframeDqlClause(filters.timeframe),
    [filters.timeframe]
  );

  // Data hooks with filter params
  const {
    graph,
    status: topoStatus,
    error: topoError,
    reload: reloadTopo,
    nodeCount,
    edgeCount,
  } = useSmartscapeTopology({
    timeframeDql,
    nodeTypes: selectedTypes,
    maxNodes,
  });
  const { status: metricsStatus, error: metricsError, reload: reloadMetrics } = useMetricsOverlay(graph, timeframeDql);
  const capacityReport = useCapacityReport();

  // Selection
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null);

  const stats = useMemo(() => graphStats(graph), [graph]);

  const handleNodeClick = useCallback((nodeId: string, node: TopologyNode) => {
    setSelectedNodeId(nodeId);
    setSelectedNode(node);
    capacityReport.clear();
  }, [capacityReport]);

  const handleGenerateReport = useCallback(() => {
    if (selectedNode) {
      capacityReport.generate(selectedNode);
    }
  }, [selectedNode, capacityReport]);

  const handleBackToTopology = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedNode(null);
    capacityReport.clear();
  }, [capacityReport]);

  const handleRefresh = useCallback(() => {
    reloadTopo();
    reloadMetrics();
  }, [reloadTopo, reloadMetrics]);

  const handleTimeframeChange = useCallback(
    (tf: Timeframe | null) => {
      updateFilter("timeframe", tf ?? createDefaultTimeframe());
    },
    [updateFilter]
  );

  const handleTypeChange = useCallback((values: SmartscapeNodeType[] | null) => {
    setSelectedTypes(values && values.length > 0 ? values : DEFAULT_SELECTED_TYPES);
  }, []);

  const handleMaxNodesChange = useCallback((value: number | null) => {
    setMaxNodes(value ?? 500);
  }, []);

  const isLoading = topoStatus === "loading";
  const metricsLoading = metricsStatus === "loading";
  const hasError = topoStatus === "error" || metricsStatus === "error";

  return (
    <Flex flexDirection="column" gap={0} style={{ height: "100%" }}>
      {/* ── TitleBar ── */}
      <TitleBar>
        <TitleBar.Title>
          Topology Explorer {!isLoading && nodeCount > 0 && (
            <Text style={{ color: CssTokens.textSecondary, fontWeight: 400 }}>
              {formatNumber(nodeCount)} nodes, {formatNumber(edgeCount)} edges
            </Text>
          )}
        </TitleBar.Title>
        <TitleBar.Subtitle>
          Visual Smartscape topology with Dynatrace Intelligence capacity forecasting
        </TitleBar.Subtitle>
        <TitleBar.Suffix>
          <Flex alignItems="center" gap={8}>
            <TimeframeSelector
              value={filters.timeframe}
              onChange={handleTimeframeChange}
            />
            {metricsLoading && (
              <Text style={{ color: CssTokens.textSecondary, fontSize: 12 }}>
                Loading metrics…
              </Text>
            )}
            <Button variant="default" onClick={handleRefresh} disabled={isLoading}>
              <Button.Prefix><RefreshIcon /></Button.Prefix>
              Refresh
            </Button>
          </Flex>
        </TitleBar.Suffix>
      </TitleBar>

      <Flex flexDirection="column" padding={16} gap={16}>
        {/* ── Filter Selects ── */}
        <Flex gap={12} alignItems="center" flexWrap="wrap">
          <Select
            value={selectedTypes}
            onChange={handleTypeChange}
            multiple
          >
            <Select.Trigger placeholder="Entity types" style={{ minWidth: 180 }} />
            <Select.Content>
              {NODE_TYPE_OPTIONS.map((opt) => (
                <Select.Option key={opt.id} value={opt.id}>
                  {opt.label}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>

          <Select
            value={maxNodes}
            onChange={handleMaxNodesChange}
          >
            <Select.Trigger placeholder="Max nodes" style={{ minWidth: 130 }} />
            <Select.Content>
              {MAX_NODES_OPTIONS.map((opt) => (
                <Select.Option key={opt.value} value={opt.value}>
                  {opt.label}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </Flex>

      {/* ── Stats bar ── */}
      {!isLoading && nodeCount > 0 && (
        <Flex gap={24} alignItems="center" style={{ padding: "0 4px" }}>
          {Object.entries(stats.nodeTypeBreakdown).map(([type, count]) => (
            <Text key={type} style={{ color: CssTokens.textSecondary, fontSize: 13 }}>
              {NODE_TYPE_OPTIONS.find((o) => o.id === type)?.label ?? type}: {count}
            </Text>
          ))}
        </Flex>
      )}

      {/* ── Error state ── */}
      {hasError && (
        <Surface>
          <Flex padding={16} gap={8}>
            <CriticalIcon style={{ color: CssTokens.feedbackCritical }} />
            <Text style={{ color: CssTokens.feedbackCritical }}>
              {topoError ?? metricsError}
            </Text>
          </Flex>
        </Surface>
      )}

      {/* ── Skeleton loading state ── */}
      {isLoading && (
        <Surface>
          <Flex flexDirection="column" padding={16} gap={12}>
            <Skeleton height={24} width="30%" />
            <Skeleton height={400} width="100%" />
            <Flex gap={16}>
              <SkeletonText lines={2} width="25%" />
              <SkeletonText lines={2} width="25%" />
              <SkeletonText lines={2} width="25%" />
              <SkeletonText lines={2} width="25%" />
            </Flex>
          </Flex>
        </Surface>
      )}

      {/* ── Visual Topology Graph ── */}
      {!isLoading && nodeCount > 0 && (
        <Surface>
          <Flex flexDirection="column" padding={16} gap={8}>
            <Flex justifyContent="space-between" alignItems="center">
              <Text style={{ fontWeight: 600, fontSize: 16 }}>Smartscape Topology</Text>
              <Text style={{ color: CssTokens.textSecondary, fontSize: 12 }}>
                Click a node to select it. Zoom/pan to explore.
              </Text>
            </Flex>
            <TopologyGraphView
              graph={graph}
              selectedNodeId={selectedNodeId}
              onNodeClick={handleNodeClick}
              height={500}
            />
          </Flex>
        </Surface>
      )}

      {/* ── Selected node panel ── */}
      {selectedNode && (
        <Surface>
          <Flex padding={16} gap={16} alignItems="center" justifyContent="space-between">
            <Flex flexDirection="column" gap={4}>
              <Text style={{ fontWeight: 700, fontSize: 16 }}>
                Selected: {selectedNode.name}
              </Text>
              <Text style={{ color: CssTokens.textSecondary }}>
                {selectedNode.type} •{" "}
                {(graph.adjacency.get(selectedNode.id) ?? []).length} downstream •{" "}
                {(graph.reverseAdjacency.get(selectedNode.id) ?? []).length} upstream
              </Text>
            </Flex>
            <Flex gap={8}>
              {(selectedNode.type === "HOST" || selectedNode.type === "AWS_EC2_INSTANCE") ? (
                <Button
                  variant="emphasized"
                  onClick={handleGenerateReport}
                  disabled={capacityReport.status === "loading"}
                >
                  {capacityReport.status === "loading"
                    ? "Generating Report…"
                    : "Generate Capacity Report"}
                </Button>
              ) : (
                <Text style={{ color: CssTokens.textSecondary, fontStyle: "italic" }}>
                  Capacity reports available for HOST nodes
                </Text>
              )}
              <Button variant="default" onClick={handleBackToTopology}>
                Deselect
              </Button>
            </Flex>
          </Flex>
        </Surface>
      )}

      {/* ── Capacity Report ── */}
      {(capacityReport.status !== "idle" || capacityReport.report) && (
        <CapacityReport
          report={capacityReport.report}
          status={capacityReport.status}
          error={capacityReport.error}
          onBack={handleBackToTopology}
        />
      )}

      {/* ── Empty state ── */}
      {!isLoading && !hasError && nodeCount === 0 && (
        <EmptyState>
          <EmptyState.Title>No topology data</EmptyState.Title>
          <EmptyState.Details>
            No Smartscape nodes found. Ensure OneAgent is deployed and entities are reporting.
          </EmptyState.Details>
        </EmptyState>
      )}
      </Flex>
    </Flex>
  );
};
