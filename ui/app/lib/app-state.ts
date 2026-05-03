// ============================================================
// App State Service Layer — Capacity Planner
// ============================================================
// Typed helpers for reading/writing App State:
//   - cost-model — Shared cost configuration for all hosts
//   - alert-config — Alert thresholds per host
// ============================================================

import { stateClient } from "@dynatrace-sdk/client-state";
import type { CostModelState, HostCostModel, HostAlertConfig } from "../types";

const KEY_COST_MODEL = "cost-model";
const KEY_ALERT_PREFIX = "alert-config:";

// ============================================================
// Cost Model
// ============================================================

const DEFAULT_COST_STATE: CostModelState = {
  hosts: {},
  defaultTierCosts: {
    small: 50,
    medium: 150,
    large: 400,
    xlarge: 800,
    custom: 0,
  },
};

/** Load the cost model from App State. Returns defaults if not found. */
export async function loadCostModel(): Promise<CostModelState> {
  try {
    const result = await stateClient.getAppState({ key: KEY_COST_MODEL });
    if (result.value) {
      return JSON.parse(result.value) as CostModelState;
    }
    return { ...DEFAULT_COST_STATE };
  } catch {
    return { ...DEFAULT_COST_STATE };
  }
}

/** Save the entire cost model to App State. */
export async function saveCostModel(state: CostModelState): Promise<void> {
  await stateClient.setAppState({
    key: KEY_COST_MODEL,
    body: { value: JSON.stringify(state) },
  });
}

/** Update or create a single host cost entry. */
export async function setHostCost(cost: HostCostModel): Promise<void> {
  const state = await loadCostModel();
  state.hosts[cost.hostId] = cost;
  await saveCostModel(state);
}

/** Remove a host cost entry. */
export async function removeHostCost(hostId: string): Promise<void> {
  const state = await loadCostModel();
  delete state.hosts[hostId];
  await saveCostModel(state);
}

/** Get cost for a specific host, or null if not configured. */
export async function getHostCost(hostId: string): Promise<HostCostModel | null> {
  const state = await loadCostModel();
  return state.hosts[hostId] ?? null;
}

// ============================================================
// Alert Configuration
// ============================================================

const DEFAULT_THRESHOLDS = [
  { metric: "dt.host.cpu.usage", warningPct: 70, criticalPct: 85, forecastHorizonDays: 30, enabled: true },
  { metric: "dt.host.memory.usage", warningPct: 75, criticalPct: 90, forecastHorizonDays: 30, enabled: true },
  { metric: "dt.host.disk.used.percent", warningPct: 75, criticalPct: 90, forecastHorizonDays: 30, enabled: true },
];

/** Load alert config for a specific host. Returns defaults if not configured. */
export async function loadAlertConfig(hostId: string, hostName: string): Promise<HostAlertConfig> {
  try {
    const result = await stateClient.getAppState({ key: `${KEY_ALERT_PREFIX}${hostId}` });
    if (result.value) {
      return JSON.parse(result.value) as HostAlertConfig;
    }
    return { hostId, hostName, thresholds: [...DEFAULT_THRESHOLDS], updatedAt: new Date().toISOString() };
  } catch {
    return { hostId, hostName, thresholds: [...DEFAULT_THRESHOLDS], updatedAt: new Date().toISOString() };
  }
}

/** Save alert config for a specific host. */
export async function saveAlertConfig(config: HostAlertConfig): Promise<void> {
  await stateClient.setAppState({
    key: `${KEY_ALERT_PREFIX}${config.hostId}`,
    body: { value: JSON.stringify(config) },
  });
}

/** Load all alert configs. Uses filter to find all keys with the alert prefix. */
export async function loadAllAlertConfigs(): Promise<HostAlertConfig[]> {
  try {
    const result = await stateClient.getAppStates({
      filter: `key starts-with '${KEY_ALERT_PREFIX}'`,
    });
    return (result ?? [])
      .filter((item) => item.value)
      .map((item) => JSON.parse(item.value!) as HostAlertConfig);
  } catch {
    return [];
  }
}
