// ============================================================
// NeighborGraph — Interactive capacity-aware topology
// Features: direction/type filters, multi-select, group analysis panel
// ============================================================

import React, { useMemo, useCallback, useState } from "react";
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
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import {
  HostsIcon,
  ServicesIcon,
  ContainerIcon,
  ApplicationsIcon,
} from "@dynatrace/strato-icons";
import type { NeighborNode } from "../hooks/useHostNeighbors";
import { CssTokens } from "../utils/design-tokens";

// ---- Hardcoded SVG-safe colors ----
const C = {
  upstream: "#38bdf8",
  downstream: "#fb923c",
  runs_on: "#4ade80",
  host: "#818cf8",
  selected: "#facc15",
  text: "#e2e8f0",
  dim: "#94a3b8",
  surface: "#1e1e2e",
  bg: "#121220",
  grid: "#333",
  handle: "#555",
};

function getNodeIcon(type: string): React.ReactNode {
  if (type === "HOST") return <HostsIcon />;
  if (type === "SERVICE") return <ServicesIcon />;
  if (type === "PROCESS" || type === "CONTAINER") return <ContainerIcon />;
  if (type === "FRONTEND") return <ApplicationsIcon />;
  return <ServicesIcon />;
}

// ---- Node data types ----
interface HostNodeData { label: string; [key: string]: unknown }
interface NeighborNodeData {
  label: string;
  entityType: string;
  direction: "upstream" | "downstream" | "runs_on";
  callPct: number | null;
  callCount: number | null;
  isSelected: boolean;
  [key: string]: unknown;
}

// ---- Host Node ----
const HostNode = React.memo(function HostNode({ data }: { data: HostNodeData }) {
  return (
    <div style={{
      background: C.surface, border: `3px solid ${C.host}`, borderRadius: 10,
      padding: "12px 20px", minWidth: 150, maxWidth: 220,
      boxShadow: `0 0 10px ${C.host}44`,
    }}>
      <Handle type="target" position={Position.Top} style={{ background: C.handle, width: 6, height: 6 }} />
      <Flex flexDirection="column" alignItems="center" gap={4}>
        <div style={{ color: C.host, fontSize: 20 }}><HostsIcon /></div>
        <Text textStyle="base-emphasized" style={{ textAlign: "center", color: C.text, wordBreak: "break-word" }}>
          {data.label}
        </Text>
      </Flex>
      <Handle type="source" position={Position.Bottom} style={{ background: C.handle, width: 6, height: 6 }} />
    </div>
  );
});

// ---- Neighbor Node (selection-aware) ----
const NeighborEntityNode = React.memo(function NeighborEntityNode({ data }: { data: NeighborNodeData }) {
  const dirColor = C[data.direction];
  const border = data.isSelected ? `3px solid ${C.selected}` : `2px solid ${dirColor}`;
  const shadow = data.isSelected ? `0 0 0 3px ${C.selected}66` : "0 1px 3px rgba(0,0,0,0.3)";

  return (
    <div style={{
      background: C.surface, border, borderRadius: 8,
      padding: "8px 12px", minWidth: 140, maxWidth: 200,
      boxShadow: shadow, cursor: "pointer",
    }}>
      <Handle type="target" position={Position.Top} style={{ background: C.handle, width: 6, height: 6 }} />
      <Flex flexDirection="column" alignItems="center" gap={4}>
        <div style={{ color: C.text, fontSize: 16 }}>{getNodeIcon(data.entityType)}</div>
        <Text textStyle="small" style={{ textAlign: "center", color: C.text, wordBreak: "break-word" }}>{data.label}</Text>
        <Text textStyle="small" style={{ color: C.dim, textTransform: "uppercase", fontSize: 9, letterSpacing: 0.5 }}>{data.entityType}</Text>
        {data.callCount !== null && (
          <Text textStyle="small-emphasized" style={{ color: dirColor, fontSize: 10 }}>
            {data.callCount.toLocaleString()} calls{data.callPct !== null ? ` (${data.callPct}%)` : ""}
          </Text>
        )}
      </Flex>
      <Handle type="source" position={Position.Bottom} style={{ background: C.handle, width: 6, height: 6 }} />
    </div>
  );
});

const nodeTypes: NodeTypes = { hostNode: HostNode, neighborNode: NeighborEntityNode };

// ---- Layout ----
function layoutGraph(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: 80, nodesep: 40, edgesep: 20 });
  for (const n of nodes) g.setNode(n.id, { width: 180, height: 80 });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return {
    nodes: nodes.map((n) => {
      const p = g.node(n.id);
      return { ...n, position: { x: p.x - 90, y: p.y - 40 } };
    }),
    edges,
  };
}

// ---- Build graph from filtered neighbors ----
function buildFlowData(
  neighbors: NeighborNode[],
  hostId: string,
  hostName: string,
  selectedIds: Set<string>,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  nodes.push({ id: hostId, type: "hostNode", position: { x: 0, y: 0 }, data: { label: hostName } });

  for (const n of neighbors) {
    nodes.push({
      id: n.id,
      type: "neighborNode",
      position: { x: 0, y: 0 },
      data: {
        label: n.name, entityType: n.type, direction: n.direction,
        callPct: n.callPct, callCount: n.callCount,
        isSelected: selectedIds.has(n.id),
      } satisfies NeighborNodeData,
    });

    const color = C[n.direction];
    const label = n.callCount != null
      ? `${n.callCount.toLocaleString()} calls`
      : n.direction === "runs_on" ? "runs on" : n.edgeType;

    if (n.direction === "upstream") {
      edges.push({
        id: `e-${n.id}-${hostId}`, source: n.id, target: hostId,
        type: "smoothstep",
        style: { stroke: color, strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color },
        label, labelStyle: { fontSize: 9, fill: C.text },
      });
    } else if (n.direction === "downstream") {
      edges.push({
        id: `e-${hostId}-${n.id}`, source: hostId, target: n.id,
        type: "smoothstep",
        style: { stroke: color, strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color },
        label, labelStyle: { fontSize: 9, fill: C.text },
      });
    } else {
      edges.push({
        id: `e-${hostId}-${n.id}`, source: hostId, target: n.id,
        type: "smoothstep",
        style: { stroke: color, strokeWidth: 1, strokeDasharray: "5 3" },
        markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10, color },
        label, labelStyle: { fontSize: 9, fill: C.dim },
      });
    }
  }

  return layoutGraph(nodes, edges);
}

// ---- Selection Panel — shows selected nodes + group summary ----
const SelectionPanel: React.FC<{
  selected: NeighborNode[];
  allNeighbors: NeighborNode[];
  onClear: () => void;
}> = ({ selected, allNeighbors, onClear }) => {
  if (selected.length === 0) return null;

  const totalCalls = selected.reduce((s, n) => s + (n.callCount ?? 0), 0);
  const upCount = selected.filter((n) => n.direction === "upstream").length;
  const downCount = selected.filter((n) => n.direction === "downstream").length;
  const procCount = selected.filter((n) => n.direction === "runs_on").length;
  const types = [...new Set(selected.map((n) => n.type))];

  // Compute what % of total traffic the selected group represents
  const totalInbound = allNeighbors.filter((n) => n.direction === "upstream").reduce((s, n) => s + (n.callCount ?? 0), 0);
  const totalOutbound = allNeighbors.filter((n) => n.direction === "downstream").reduce((s, n) => s + (n.callCount ?? 0), 0);
  const selectedInbound = selected.filter((n) => n.direction === "upstream").reduce((s, n) => s + (n.callCount ?? 0), 0);
  const selectedOutbound = selected.filter((n) => n.direction === "downstream").reduce((s, n) => s + (n.callCount ?? 0), 0);
  const inPct = totalInbound > 0 ? Math.round((selectedInbound / totalInbound) * 100) : 0;
  const outPct = totalOutbound > 0 ? Math.round((selectedOutbound / totalOutbound) * 100) : 0;

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.selected}`, borderRadius: 8,
      padding: 12, maxHeight: 260, overflowY: "auto",
    }}>
      <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: 8 }}>
        <Text textStyle="base-emphasized" style={{ color: C.selected }}>
          {selected.length} selected
        </Text>
        <Button variant="default" onClick={onClear}>
          <Text textStyle="small" style={{ color: C.dim }}>Clear</Text>
        </Button>
      </Flex>

      {/* Group summary */}
      <Flex gap={16} flexWrap="wrap" style={{ marginBottom: 8 }}>
        {upCount > 0 && (
          <Flex flexDirection="column" gap={2}>
            <Text textStyle="small" style={{ color: C.dim }}>Inbound</Text>
            <Text textStyle="small-emphasized" style={{ color: C.upstream }}>
              {upCount} callers — {selectedInbound.toLocaleString()} calls ({inPct}% of total)
            </Text>
          </Flex>
        )}
        {downCount > 0 && (
          <Flex flexDirection="column" gap={2}>
            <Text textStyle="small" style={{ color: C.dim }}>Outbound</Text>
            <Text textStyle="small-emphasized" style={{ color: C.downstream }}>
              {downCount} called — {selectedOutbound.toLocaleString()} calls ({outPct}% of total)
            </Text>
          </Flex>
        )}
        {procCount > 0 && (
          <Flex flexDirection="column" gap={2}>
            <Text textStyle="small" style={{ color: C.dim }}>Processes</Text>
            <Text textStyle="small-emphasized" style={{ color: C.runs_on }}>{procCount} processes</Text>
          </Flex>
        )}
        <Flex flexDirection="column" gap={2}>
          <Text textStyle="small" style={{ color: C.dim }}>Total calls</Text>
          <Text textStyle="small-emphasized" style={{ color: C.text }}>{totalCalls.toLocaleString()}</Text>
        </Flex>
        <Flex flexDirection="column" gap={2}>
          <Text textStyle="small" style={{ color: C.dim }}>Entity types</Text>
          <Text textStyle="small-emphasized" style={{ color: C.text }}>{types.join(", ")}</Text>
        </Flex>
      </Flex>

      {/* Individual entities */}
      <Flex flexDirection="column" gap={4}>
        {selected.map((n) => (
          <Flex key={n.id} alignItems="center" gap={8} style={{
            padding: "4px 8px", borderRadius: 4,
            background: `${C[n.direction]}11`, borderLeft: `3px solid ${C[n.direction]}`,
          }}>
            <div style={{ color: C[n.direction], fontSize: 14, flexShrink: 0 }}>{getNodeIcon(n.type)}</div>
            <Flex flexDirection="column" style={{ minWidth: 0 }}>
              <Text textStyle="small" style={{ color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {n.name}
              </Text>
              <Text textStyle="small" style={{ color: C.dim, fontSize: 10 }}>
                {n.type} · {n.direction} · {n.edgeType}
                {n.callCount != null ? ` · ${n.callCount.toLocaleString()} calls` : ""}
              </Text>
            </Flex>
          </Flex>
        ))}
      </Flex>
    </div>
  );
};

// ---- Filter toolbar ----
type DirFilter = "upstream" | "downstream" | "runs_on";

const FilterToolbar: React.FC<{
  neighbors: NeighborNode[];
  activeDirs: Set<DirFilter>;
  activeTypes: Set<string>;
  onToggleDir: (d: DirFilter) => void;
  onToggleType: (t: string) => void;
}> = ({ neighbors, activeDirs, activeTypes, onToggleDir, onToggleType }) => {
  const dirCounts = useMemo(() => {
    const m: Record<string, number> = { upstream: 0, downstream: 0, runs_on: 0 };
    for (const n of neighbors) m[n.direction]++;
    return m;
  }, [neighbors]);

  const entityTypes = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of neighbors) m.set(n.type, (m.get(n.type) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [neighbors]);

  const dirButtons: Array<{ key: DirFilter; label: string; color: string }> = [
    { key: "upstream", label: `Callers (${dirCounts.upstream})`, color: C.upstream },
    { key: "downstream", label: `Called (${dirCounts.downstream})`, color: C.downstream },
    { key: "runs_on", label: `Processes (${dirCounts.runs_on})`, color: C.runs_on },
  ];

  return (
    <Flex gap={8} flexWrap="wrap" alignItems="center">
      <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>Direction:</Text>
      {dirButtons.map((d) => (
        <Button
          key={d.key}
          variant={activeDirs.has(d.key) ? "accent" : "default"}
          onClick={() => onToggleDir(d.key)}
        >
          <span style={{ color: activeDirs.has(d.key) ? undefined : d.color }}>{d.label}</span>
        </Button>
      ))}
      <Text textStyle="small" style={{ color: CssTokens.textSecondary, marginLeft: 8 }}>Type:</Text>
      {entityTypes.map(([type, count]) => (
        <Button
          key={type}
          variant={activeTypes.has(type) ? "accent" : "default"}
          onClick={() => onToggleType(type)}
        >
          {type} ({count})
        </Button>
      ))}
    </Flex>
  );
};

// ---- Inner Graph ----
function NeighborGraphInner({
  neighbors, hostId, hostName, selectedIds, onNodeClick,
}: {
  neighbors: NeighborNode[];
  hostId: string;
  hostName: string;
  selectedIds: Set<string>;
  onNodeClick: (id: string, ctrlKey: boolean) => void;
}) {
  const { fitView } = useReactFlow();
  const { nodes, edges } = useMemo(
    () => buildFlowData(neighbors, hostId, hostName, selectedIds),
    [neighbors, hostId, hostName, selectedIds],
  );

  const onInit = useCallback(() => {
    setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50);
  }, [fitView]);

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (node.type === "hostNode") return; // don't select the main host
      onNodeClick(node.id, event.ctrlKey || event.metaKey);
    },
    [onNodeClick],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onInit={onInit}
      onNodeClick={handleNodeClick}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.1}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={1} color={C.grid} />
      <Controls showInteractive={false} style={{ background: C.surface, borderRadius: 8 }} />
      <MiniMap
        nodeColor={(n) => {
          if (n.type === "hostNode") return C.host;
          const d = n.data as NeighborNodeData;
          return d.isSelected ? C.selected : (C[d.direction] ?? C.handle);
        }}
        style={{ background: C.surface }}
      />
    </ReactFlow>
  );
}

// ---- Public component ----
export interface NeighborGraphProps {
  neighbors: NeighborNode[];
  status: string;
  error: string | null;
  hostId: string;
  hostName: string;
}

export const NeighborGraph: React.FC<NeighborGraphProps> = ({ neighbors, status, error, hostId, hostName }) => {
  const [activeDirs, setActiveDirs] = useState<Set<DirFilter>>(new Set(["upstream", "downstream", "runs_on"]));
  const [activeTypes, setActiveTypes] = useState<Set<string>>(() => new Set(neighbors.map((n) => n.type)));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Initialize activeTypes when neighbors change
  React.useEffect(() => {
    setActiveTypes(new Set(neighbors.map((n) => n.type)));
    setSelectedIds(new Set());
  }, [neighbors]);

  const toggleDir = useCallback((d: DirFilter) => {
    setActiveDirs((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });
  }, []);

  const toggleType = useCallback((t: string) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }, []);

  const handleNodeClick = useCallback((id: string, ctrlKey: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(ctrlKey ? prev : []);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Apply filters
  const filtered = useMemo(
    () => neighbors.filter((n) => activeDirs.has(n.direction) && activeTypes.has(n.type)),
    [neighbors, activeDirs, activeTypes],
  );

  const selectedNeighbors = useMemo(
    () => neighbors.filter((n) => selectedIds.has(n.id)),
    [neighbors, selectedIds],
  );

  if (status === "loading") {
    return (
      <Flex alignItems="center" justifyContent="center" gap={8} style={{ height: 400 }}>
        <ProgressCircle size="small" />
        <Text>Loading topology…</Text>
      </Flex>
    );
  }
  if (status === "error") {
    return (
      <Flex alignItems="center" justifyContent="center" style={{ height: 400 }}>
        <Text style={{ color: CssTokens.feedbackCritical }}>{error}</Text>
      </Flex>
    );
  }
  if (neighbors.length === 0) {
    return (
      <Flex alignItems="center" justifyContent="center" style={{ height: 400 }}>
        <Text style={{ color: CssTokens.textSecondary }}>No connected entities found.</Text>
      </Flex>
    );
  }

  return (
    <Flex flexDirection="column" gap={8}>
      {/* Filter toolbar */}
      <FilterToolbar
        neighbors={neighbors}
        activeDirs={activeDirs}
        activeTypes={activeTypes}
        onToggleDir={toggleDir}
        onToggleType={toggleType}
      />

      <Text textStyle="small" style={{ color: CssTokens.textSecondary }}>
        Showing {filtered.length} of {neighbors.length} entities. Click to select, Ctrl+click to multi-select.
      </Text>

      {/* Graph + Selection panel side by side */}
      <Flex gap={12} style={{ minHeight: 500 }}>
        <div style={{ flex: 1, minWidth: 0, height: 500, background: C.bg, borderRadius: 8, overflow: "hidden" }}>
          <ReactFlowProvider>
            <NeighborGraphInner
              neighbors={filtered}
              hostId={hostId}
              hostName={hostName}
              selectedIds={selectedIds}
              onNodeClick={handleNodeClick}
            />
          </ReactFlowProvider>
        </div>

        {/* Selection panel (right side) */}
        {selectedNeighbors.length > 0 && (
          <div style={{ width: 320, flexShrink: 0 }}>
            <SelectionPanel selected={selectedNeighbors} allNeighbors={neighbors} onClear={clearSelection} />
          </div>
        )}
      </Flex>
    </Flex>
  );
};
