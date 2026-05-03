// ============================================================
// Capacity Planner — Core Type Definitions
// ============================================================

/** Smartscape node types we care about for capacity planning */
export type SmartscapeNodeType =
  | "SERVICE"
  | "HOST"
  | "PROCESS"
  | "CONTAINER"
  | "K8S_CLUSTER"
  | "K8S_NODE"
  | "K8S_POD"
  | "K8S_NAMESPACE"
  | "K8S_DEPLOYMENT"
  | "K8S_STATEFULSET"
  | "K8S_DAEMONSET"
  | "FRONTEND"
  | "AWS_EC2_INSTANCE"
  | "AWS_RDS_DBINSTANCE"
  | "AWS_LAMBDA_FUNCTION"
  | "AWS_ELASTICLOADBALANCINGV2_LOADBALANCER"
  | "AWS_SQS_QUEUE"
  | "AWS_S3_BUCKET"
  | "AWS_ECS_SERVICE"
  | "AWS_EKS_CLUSTER";

/** Edge types in Smartscape */
export type SmartscapeEdgeType =
  | "calls"
  | "runs_on"
  | "belongs_to"
  | "contains"
  | "balanced_by"
  | "balances"
  | "is_part_of"
  | "is_attached_to"
  | "uses"
  | "instance_of"
  | "routes_to"
  | "monitors";

// ============================================================
// Topology Graph
// ============================================================

/** A node in the capacity planning graph */
export interface TopologyNode {
  id: string;
  name: string;
  type: SmartscapeNodeType;
  /** Current metric values */
  metrics: NodeMetrics;
  /** Capacity limits (from cloud config or manual) */
  limits: NodeLimits;
  /** Metadata from Smartscape fields */
  metadata: Record<string, unknown>;
}

/** Current and recent metric values for a node */
export interface NodeMetrics {
  cpuAvg?: number;
  cpuP95?: number;
  memoryAvg?: number;
  memoryP95?: number;
  diskUsedPct?: number;
  requestRate?: number;
  errorRate?: number;
  responseTimeP95?: number;
  /** Raw timeseries for forecasting (metric key → values) */
  timeseries: Record<string, number[]>;
}

/** Capacity limits for a node */
export interface NodeLimits {
  maxCpuPct: number;
  maxMemoryPct: number;
  maxDiskPct: number;
  maxRequestRate?: number;
  /** Cloud instance type (e.g., m5.xlarge) */
  instanceType?: string;
  /** ASG max instances */
  maxInstances?: number;
  /** Current instance count */
  currentInstances?: number;
  /** Can this node scale horizontally? */
  canScaleHorizontally: boolean;
  /** Can this node scale vertically? */
  canScaleVertically: boolean;
}

/** An edge in the capacity planning graph */
export interface TopologyEdge {
  id: string;
  sourceId: string;
  targetId: string;
  sourceType: SmartscapeNodeType;
  targetType: SmartscapeNodeType;
  edgeType: SmartscapeEdgeType;
  /** Request fan-out ratio (downstream calls per upstream request) */
  fanOutRatio: number;
  /** Average data transfer per request (bytes) */
  dataTransferBytes?: number;
  /** Is this a dynamic (runtime observed) or static (config) edge? */
  edgeKind: "static" | "dynamic";
}

/** The full topology graph */
export interface TopologyGraph {
  nodes: Map<string, TopologyNode>;
  edges: TopologyEdge[];
  /** Adjacency list: nodeId → outgoing edges */
  adjacency: Map<string, TopologyEdge[]>;
  /** Reverse adjacency: nodeId → incoming edges */
  reverseAdjacency: Map<string, TopologyEdge[]>;
}

// ============================================================
// Scenario / Simulation
// ============================================================

export type ScenarioType =
  | "traffic_growth"
  | "seasonal_spike"
  | "new_deployment"
  | "data_growth"
  | "database_scaling"
  | "right_sizing";

/** A what-if scenario definition */
export interface Scenario {
  id: string;
  name: string;
  type: ScenarioType;
  /** Entry point node IDs where the change originates */
  entryPoints: string[];
  /** Scenario-specific parameters */
  params: ScenarioParams;
  /** Forecast time horizon in days */
  horizonDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface TrafficGrowthParams {
  type: "traffic_growth";
  /** Multiplier: 2 = double, 5 = 5x, etc. */
  multiplier: number;
  /** Ramp-up period in days (0 = instant) */
  rampUpDays: number;
  /** Is this sustained or a burst? */
  pattern: "sustained" | "burst";
}

export interface SeasonalSpikeParams {
  type: "seasonal_spike";
  /** Peak multiplier during spike */
  peakMultiplier: number;
  /** Spike duration in hours */
  durationHours: number;
  /** Description (e.g., "Black Friday", "Month-end batch") */
  label: string;
}

export interface NewDeploymentParams {
  type: "new_deployment";
  /** Expected request rate for the new service */
  expectedRequestRate: number;
  /** Dependencies (existing node IDs this new service will call) */
  downstreamDependencies: string[];
}

export interface DataGrowthParams {
  type: "data_growth";
  /** Monthly data growth rate as a multiplier (1.1 = 10% monthly growth) */
  monthlyGrowthRate: number;
  /** Affects storage, query volume, or both */
  impactType: "storage" | "queries" | "both";
}

export interface DatabaseScalingParams {
  type: "database_scaling";
  /** Expected query volume multiplier */
  queryMultiplier: number;
  /** Expected connection count growth multiplier */
  connectionMultiplier: number;
}

export interface RightSizingParams {
  type: "right_sizing";
  /** Target utilization band (e.g., [60, 80] = 60-80% target) */
  targetUtilizationRange: [number, number];
  /** Optimize for cost or performance */
  priority: "cost" | "performance" | "balanced";
}

export type ScenarioParams =
  | TrafficGrowthParams
  | SeasonalSpikeParams
  | NewDeploymentParams
  | DataGrowthParams
  | DatabaseScalingParams
  | RightSizingParams;

// ============================================================
// Simulation Results
// ============================================================

export type BottleneckSeverity = "critical" | "warning" | "healthy" | "over_provisioned";

/** Simulation result for a single node */
export interface NodeSimulationResult {
  nodeId: string;
  nodeName: string;
  nodeType: SmartscapeNodeType;
  /** The multiplier that reached this node through the graph */
  effectiveMultiplier: number;
  /** Current utilization % */
  currentUtilization: number;
  /** Projected utilization % under scenario */
  projectedUtilization: number;
  /** Headroom before capacity limit */
  headroomPct: number;
  /** Severity classification */
  severity: BottleneckSeverity;
  /** Recommended action */
  recommendation: string;
  /** Estimated days until capacity exhaustion (null = won't exhaust) */
  daysToExhaustion: number | null;
  /** Which metrics are the constraint */
  constraintMetrics: string[];
}

/** Overall simulation output */
export interface SimulationResult {
  scenarioId: string;
  scenarioName: string;
  /** All affected nodes with their projected state */
  nodeResults: NodeSimulationResult[];
  /** Nodes sorted by severity (most critical first) */
  bottlenecks: NodeSimulationResult[];
  /** The critical path (chain of nodes to first bottleneck) */
  criticalPath: string[];
  /** Total nodes analyzed */
  nodesAnalyzed: number;
  /** Simulation timestamp */
  timestamp: string;
}

// ============================================================
// Metric definitions
// ============================================================

export interface MetricDefinition {
  key: string;
  label: string;
  unit: string;
  aggregation: "avg" | "sum" | "max" | "min" | "percentile";
  /** Which node types does this metric apply to? */
  applicableNodeTypes: SmartscapeNodeType[];
  /** Threshold: above this % = warning */
  warningThreshold: number;
  /** Threshold: above this % = critical */
  criticalThreshold: number;
}

/** All metrics we track for capacity planning */
export const CAPACITY_METRICS: MetricDefinition[] = [
  {
    key: "dt.host.cpu.usage",
    label: "CPU Usage",
    unit: "%",
    aggregation: "avg",
    applicableNodeTypes: ["HOST", "AWS_EC2_INSTANCE"],
    warningThreshold: 70,
    criticalThreshold: 85,
  },
  {
    key: "dt.host.memory.usage",
    label: "Memory Usage",
    unit: "%",
    aggregation: "avg",
    applicableNodeTypes: ["HOST", "AWS_EC2_INSTANCE"],
    warningThreshold: 75,
    criticalThreshold: 90,
  },
  {
    key: "dt.host.disk.used.percent",
    label: "Disk Usage",
    unit: "%",
    aggregation: "avg",
    applicableNodeTypes: ["HOST", "AWS_EC2_INSTANCE"],
    warningThreshold: 75,
    criticalThreshold: 90,
  },
  {
    key: "dt.service.request.count",
    label: "Request Rate",
    unit: "req/min",
    aggregation: "sum",
    applicableNodeTypes: ["SERVICE"],
    warningThreshold: 80,
    criticalThreshold: 95,
  },
  {
    key: "dt.service.request.response_time",
    label: "Response Time (p95)",
    unit: "µs",
    aggregation: "percentile",
    applicableNodeTypes: ["SERVICE"],
    warningThreshold: 70,
    criticalThreshold: 90,
  },
  {
    key: "dt.service.request.failure_count",
    label: "Error Rate",
    unit: "errors/min",
    aggregation: "sum",
    applicableNodeTypes: ["SERVICE"],
    warningThreshold: 5,
    criticalThreshold: 15,
  },
];

// ============================================================
// Forecast Accuracy Tracking (Document Store)
// ============================================================

/** A saved forecast prediction snapshot */
export interface ForecastSnapshot {
  id: string;
  hostId: string;
  hostName: string;
  metric: string;
  metricLabel: string;
  /** When the forecast was made */
  createdAt: string;
  /** The timeframe used for the forecast */
  forecastHorizonDays: number;
  /** When the forecast target date is (createdAt + horizonDays) */
  targetDate: string;
  /** Predicted value at target date (point estimate) */
  predictedValue: number;
  /** Upper bound at target date */
  predictedUpper: number;
  /** Lower bound at target date */
  predictedLower: number;
  /** Actual value at target date (filled in later when we revisit) */
  actualValue: number | null;
  /** Accuracy percentage (filled in when actualValue is set) */
  accuracyPct: number | null;
  /** Whether the actual was within the confidence band */
  withinBand: boolean | null;
}

/** Document Store wrapper for forecast snapshots */
export interface ForecastSnapshotDocument {
  type: "capacity-forecast-snapshot";
  version: 1;
  snapshots: ForecastSnapshot[];
}

// ============================================================
// Capacity Plan Documents (Document Store)
// ============================================================

/** A host's forecast within a capacity plan */
export interface PlanHostForecast {
  hostId: string;
  hostName: string;
  severity: BottleneckSeverity;
  currentCpu: number;
  currentMemory: number;
  currentDisk: number;
  forecastCpu: number;
  forecastMemory: number;
  forecastDisk: number;
  headroomPct: number;
  recommendation: string;
  monthlyCostUsd: number | null;
  scalingCostImpact: number | null;
}

/** A generated capacity plan */
export interface CapacityPlan {
  id: string;
  name: string;
  createdAt: string;
  createdBy: string;
  horizonDays: number;
  /** Fleet summary */
  summary: {
    totalHosts: number;
    criticalCount: number;
    warningCount: number;
    healthyCount: number;
    overProvisionedCount: number;
    totalMonthlyCost: number | null;
    projectedMonthlyCost: number | null;
    forecastAccuracyPct: number | null;
  };
  /** Per-host forecasts */
  hostForecasts: PlanHostForecast[];
  /** Top bottlenecks requiring action */
  actionItems: Array<{
    priority: number;
    hostId: string;
    hostName: string;
    issue: string;
    recommendation: string;
    estimatedCostImpact: number | null;
    daysToExhaustion: number | null;
  }>;
  /** Scenario results if any simulations were run */
  scenarioSummaries: Array<{
    scenarioName: string;
    criticalNodes: number;
    warningNodes: number;
    estimatedAdditionalCost: number | null;
  }>;
}

/** Document Store wrapper for capacity plan */
export interface CapacityPlanDocument {
  type: "capacity-plan";
  version: 1;
  plan: CapacityPlan;
}

// ============================================================
// Saved Simulation for Comparison (Document Store)
// ============================================================

/** A saved simulation result for comparison */
export interface SavedSimulation {
  id: string;
  savedAt: string;
  scenarioName: string;
  scenarioType: ScenarioType;
  result: SimulationResult;
  /** Cost summary at time of save */
  costSummary: {
    currentMonthlyCost: number | null;
    projectedMonthlyCost: number | null;
    costDelta: number | null;
  };
}

/** Document Store wrapper for saved simulation */
export interface SavedSimulationDocument {
  type: "capacity-simulation";
  version: 1;
  simulation: SavedSimulation;
}

// ============================================================
// Cost Model (App State)
// ============================================================

/** Cost configuration for a single host */
export interface HostCostModel {
  hostId: string;
  hostName: string;
  monthlyCostUsd: number;
  costTier: "small" | "medium" | "large" | "xlarge" | "custom";
  notes: string;
  updatedAt: string;
}

/** All cost models stored in App State */
export interface CostModelState {
  hosts: Record<string, HostCostModel>;
  defaultTierCosts: Record<string, number>;
}

// ============================================================
// Alert Configuration (App State)
// ============================================================

/** Alert threshold for a single metric on a host */
export interface AlertThreshold {
  metric: string;
  warningPct: number;
  criticalPct: number;
  forecastHorizonDays: number;
  enabled: boolean;
}

/** Alert configuration for a single host */
export interface HostAlertConfig {
  hostId: string;
  hostName: string;
  thresholds: AlertThreshold[];
  updatedAt: string;
}

/** Evaluated alert (runtime, not persisted) */
export interface EvaluatedAlert {
  hostId: string;
  hostName: string;
  metric: string;
  metricLabel: string;
  currentValue: number;
  forecastedValue: number;
  thresholdPct: number;
  severity: "warning" | "critical";
  daysToThreshold: number | null;
  message: string;
}
