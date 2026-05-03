// ============================================================
// useCostModel — React hook for host cost management
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import type { CostModelState, HostCostModel } from "../types";
import { loadCostModel, saveCostModel, setHostCost, removeHostCost } from "../lib/app-state";

interface UseCostModelResult {
  costModel: CostModelState | null;
  isLoading: boolean;
  error: string | null;
  /** Get cost for a specific host */
  getHostCost: (hostId: string) => HostCostModel | null;
  /** Set or update a host's cost */
  updateHostCost: (cost: HostCostModel) => Promise<void>;
  /** Remove a host's cost entry */
  deleteHostCost: (hostId: string) => Promise<void>;
  /** Batch-update tier defaults */
  updateTierDefaults: (tierCosts: Record<string, number>) => Promise<void>;
  /** Reload from App State */
  refresh: () => void;
}

export function useCostModel(): UseCostModelResult {
  const [costModel, setCostModel] = useState<CostModelState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await loadCostModel();
      if (mountedRef.current) {
        setCostModel(data);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Failed to load cost model");
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  const getHostCostFn = useCallback(
    (hostId: string): HostCostModel | null => {
      return costModel?.hosts[hostId] ?? null;
    },
    [costModel],
  );

  const updateHostCost = useCallback(
    async (cost: HostCostModel) => {
      await setHostCost(cost);
      if (mountedRef.current) {
        setCostModel((prev) => {
          if (!prev) return prev;
          return { ...prev, hosts: { ...prev.hosts, [cost.hostId]: cost } };
        });
      }
    },
    [],
  );

  const deleteHostCost = useCallback(
    async (hostId: string) => {
      await removeHostCost(hostId);
      if (mountedRef.current) {
        setCostModel((prev) => {
          if (!prev) return prev;
          const hosts = { ...prev.hosts };
          delete hosts[hostId];
          return { ...prev, hosts };
        });
      }
    },
    [],
  );

  const updateTierDefaults = useCallback(
    async (tierCosts: Record<string, number>) => {
      if (!costModel) return;
      const updated = { ...costModel, defaultTierCosts: tierCosts };
      await saveCostModel(updated);
      if (mountedRef.current) {
        setCostModel(updated);
      }
    },
    [costModel],
  );

  return {
    costModel,
    isLoading,
    error,
    getHostCost: getHostCostFn,
    updateHostCost,
    deleteHostCost,
    updateTierDefaults,
    refresh: load,
  };
}
