// ============================================================
// TopologyGraph — Smartscape-style vertical topology visualization
// Uses React Flow + dagre for interactive hierarchical graph layout
// ============================================================

import React, { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  Handle,
  Position,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import {
  HostsIcon,
  ServicesIcon,
  ContainerIcon,
  ApplicationsIcon,
  NetworkDevicesIcon,
} from "@dynatrace/strato-icons";
import type { TopologyGraph as TopologyGraphData, TopologyNode, SmartscapeNodeType, BottleneckSeverity } from "../types";
import { getNodeUtilization, classifySeverity } from "../lib/capacity";
import { formatPercent } from "../utils/formatting";
import { CssTokens } from "../utils/design-tokens";

// ---- Severity color mappings (using Strato design tokens) ----

const SEVERITY_COLORS: Record<BottleneckSeverity, string> = {
  critical: CssTokens.feedbackCritical,
  warning: CssTokens.feedbackWarning,
  healthy: CssTokens.feedbackSuccess,
  over_provisioned: CssTokens.feedbackInfo,
};

const SEVERITY_BORDER: Record<BottleneckSeverity, string> = {
  critical: CssTokens.feedbackCritical,
  warning: CssTokens.feedbackWarning,
  healthy: CssTokens.borderNeutral,
  over_provisioned: CssTokens.feedbackInfo,
};

function getNodeIcon(type: SmartscapeNodeType): React.ReactNode {
  switch (type) {
    case "HOST":
    case "AWS_EC2_INSTANCE":
      return <HostsIcon />;
    case "SERVICE":
    case "AWS_RDS_DBINSTANCE":
    case "AWS_LAMBDA_FUNCTION":
      return <ServicesIcon />;
    case "PROCESS":
    case "CONTAINER":
      return <ContainerIcon />;
    case "FRONTEND":
      return <ApplicationsIcon />;
    case "K8S_CLUSTER":
    case "K8S_NODE":
    case "K8S_POD":
    case "K8S_DEPLOYMENT":
    case "K8S_NAMESPACE":
      return <NetworkDevicesIcon />;
    default:
      return <ServicesIcon />;
  }
}

// ---- Custom Node Component ----
interface EntityNodeData {
  label: string;
  type: SmartscapeNodeType;
  utilization: number;
  severity: BottleneckSeverity;
  isSelected: boolean;
  [key: string]: unknown;
}

const EntityNode = React.memo(function EntityNode({ data }: { data: EntityNodeData }) {
  const severity = data.severity;
  const borderColor = SEVERITY_BORDER[severity];
  const utilColor = SEVERITY_COLORS[severity];

  return (
    <div
      style={{
        background: CssTokens.backgroundSurface,
        border: `2px solid ${borderColor}`,
        borderRadius: 8,
        padding: "8px 12px",
        minWidth: 140,
        maxWidth: 200,
        cursor: "pointer",
        boxShadow: data.isSelected
          ? `0 0 0 3px ${CssTokens.feedbackInfo}`
          : "0 1px 3px rgba(0,0,0,0.3)",
        transition: "box-shadow 0.2s, border-color 0.2s",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: CssTokens.borderNeutral, width: 6, height: 6 }} />
      <Flex flexDirection="column" alignItems="center" gap={4}>
        <div style={{ color: CssTokens.textPrimary, fontSize: 18 }}>
          {getNodeIcon(data.type)}
        </div>
        <Text
          textStyle="small"
          style={{
            textAlign: "center",
            color: CssTokens.textPrimary,
            wordBreak: "break-word",
          }}
        >
          {data.label}
        </Text>
        {data.utilization > 0 && (
          <Text textStyle="small-emphasized" style={{ color: utilColor }}>
            {formatPercent(data.utilization)}
          </Text>
        )}
      </Flex>
      <Handle type="source" position={Position.Bottom} style={{ background: CssTokens.borderNeutral, width: 6, height: 6 }} />
    </div>
  );
});

// ---- Group Node (wraps entities of same type) ----
interface GroupNodeData {
  label: string;
  count: number;
  [key: string]: unknown;
}

function GroupNode({ data }: { data: GroupNodeData }) {
  return (
    <div
      style={{
        background: "transparent",
        border: `1px dashed ${CssTokens.borderNeutral}`,
        borderRadius: 12,
        padding: "8px 16px 4px 16px",
        pointerEvents: "none",
      }}
    >
      <Text
        textStyle="small-emphasized"
        style={{
          color: CssTokens.textSecondary,
          letterSpacing: "0.5px",
          textTransform: "uppercase",
        }}
      >
        {data.label} | {data.count}
      </Text>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  entity: EntityNode,
  group: GroupNode,
};

// ---- Grid layout for disconnected nodes ----
function gridLayout(
  nodes: Node[],
  nodeWidth = 180,
  nodeHeight = 100,
  gap = 20,
  columnsPerRow = 10
): Node[] {
  // Group nodes by type, then lay out in rows per type
  const byType = new Map<string, Node[]>();
  for (const node of nodes) {
    if (node.type === "group") continue;
    const t = (node.data as EntityNodeData).type ?? "OTHER";
    let list = byType.get(t);
    if (!list) {
      list = [];
      byType.set(t, list);
    }
    list.push(node);
  }

  const result: Node[] = [];
  let yOffset = 0;

  for (const [, typeNodes] of byType) {
    for (let i = 0; i < typeNodes.length; i++) {
      const col = i % columnsPerRow;
      const row = Math.floor(i / columnsPerRow);
      result.push({
        ...typeNodes[i],
        position: { x: col * (nodeWidth + gap), y: yOffset + row * (nodeHeight + gap) },
      });
    }
    const rows = Math.ceil(typeNodes.length / columnsPerRow);
    yOffset += rows * (nodeHeight + gap) + 40; // extra gap between type groups
  }

  return result;
}

// ---- Dagre layout ----
function layoutGraph(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB"
): { nodes: Node[]; edges: Edge[] } {
  // If no edges, use grid layout — dagre produces a useless single row
  const entityNodes = nodes.filter((n) => n.type !== "group");
  if (edges.length === 0 || entityNodes.length > 200) {
    return { nodes: gridLayout(nodes), edges };
  }

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, ranksep: 80, nodesep: 40, edgesep: 20 });

  for (const node of entityNodes) {
    g.setNode(node.id, { width: 160, height: 80 });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutNodes = nodes.map((node) => {
    if (node.type === "group") return node;
    const pos = g.node(node.id);
    return {
      ...node,
      position: { x: pos.x - 80, y: pos.y - 40 },
    };
  });

  return { nodes: layoutNodes, edges };
}

// ---- Main Props ----
export interface TopologyGraphProps {
  graph: TopologyGraphData;
  selectedNodeId: string | null;
  onNodeClick: (nodeId: string, node: TopologyNode) => void;
  height?: number | string;
}

export const TopologyGraphView: React.FC<TopologyGraphProps> = ({
  graph,
  selectedNodeId,
  onNodeClick,
  height = 600,
}) => {
  // Phase 1: Layout only depends on graph structure, NOT selectedNodeId
  const { layoutNodes, layoutEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    for (const [id, tNode] of graph.nodes) {
      const util = getNodeUtilization(tNode);
      const severity = classifySeverity(util);

      nodes.push({
        id,
        type: "entity",
        position: { x: 0, y: 0 },
        data: {
          label: tNode.name,
          type: tNode.type,
          utilization: util,
          severity,
          isSelected: false, // will be patched in phase 2
        } satisfies EntityNodeData,
      });
    }

    const vizEdgeTypes = new Set(["calls", "runs_on", "contains", "belongs_to", "balanced_by"]);
    const edgeSet = new Set<string>();

    for (const edge of graph.edges) {
      if (!vizEdgeTypes.has(edge.edgeType)) continue;
      const key = `${edge.sourceId}->${edge.targetId}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);

      edges.push({
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        type: "smoothstep",
        animated: edge.edgeType === "calls",
        style: {
          stroke: CssTokens.borderNeutral,
          strokeWidth: 1.5,
        },
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
        label: edge.fanOutRatio > 1 ? `${edge.fanOutRatio.toFixed(1)}x` : undefined,
        labelStyle: { fontSize: 9, fill: CssTokens.textSecondary },
      });
    }

    const laid = layoutGraph(nodes, edges, "TB");
    return { layoutNodes: laid.nodes, layoutEdges: laid.edges };
  }, [graph]); // dagre layout only re-runs when graph changes

  // Phase 2: Patch selection flag without re-running dagre
  const flowNodes = useMemo(() => {
    return layoutNodes.map((node) => ({
      ...node,
      data: { ...node.data, isSelected: node.id === selectedNodeId },
    }));
  }, [layoutNodes, selectedNodeId]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const topoNode = graph.nodes.get(node.id);
      if (topoNode) {
        onNodeClick(node.id, topoNode);
      }
    },
    [graph, onNodeClick]
  );

  return (
    <div style={{ width: "100%", height, background: "var(--dt-colors-background-primary-default, #121220)" }}>
      <ReactFlow
        nodes={flowNodes}
        edges={layoutEdges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="var(--dt-colors-border-neutral-default, #333)" />
        <Controls
          showInteractive={false}
          style={{ background: "var(--dt-colors-surface-default, #1e1e2e)", borderRadius: 8 }}
        />
        <MiniMap
          nodeColor={(n) => {
            const data = n.data as EntityNodeData;
            return SEVERITY_COLORS[data?.severity ?? "healthy"];
          }}
          style={{ background: "var(--dt-colors-surface-default, #1e1e2e)" }}
        />
      </ReactFlow>
    </div>
  );
};
