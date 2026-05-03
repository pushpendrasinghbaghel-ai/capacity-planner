// ============================================================
// useAlertConfig — React hook for alert threshold management
// ============================================================

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { HostAlertConfig, AlertThreshold, EvaluatedAlert } from "../types";
import { loadAlertConfig, saveAlertConfig, loadAllAlertConfigs } from "../lib/app-state";

interface UseAlertConfigResult {
  /** All loaded alert configs keyed by hostId */
  configs: Record<string, HostAlertConfig>;
  isLoading: boolean;
  error: string | null;
  /** Load config for a single host */
  loadHostConfig: (hostId: string, hostName: string) => Promise<HostAlertConfig>;
  /** Save config for a single host */
  saveHostConfig: (config: HostAlertConfig) => Promise<void>;
  /** Evaluate alerts for a host given current + forecasted metrics */
  evaluateAlerts: (
    hostId: string,
    hostName: string,
    metrics: Array<{
      metric: string;
      metricLabel: string;
      currentValue: number;
      forecastedValue: number;
      daysToThreshold: number | null;
    }>,
  ) => EvaluatedAlert[];
  /** Reload all configs */
  refresh: () => void;
}

export function useAlertConfig(): UseAlertConfigResult {
  const [configs, setConfigs] = useState<Record<string, HostAlertConfig>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const all = await loadAllAlertConfigs();
      if (mountedRef.current) {
        const map: Record<string, HostAlertConfig> = {};
        for (const cfg of all) {
          map[cfg.hostId] = cfg;
        }
        setConfigs(map);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Failed to load alert configs");
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadAll();
    return () => { mountedRef.current = false; };
  }, [loadAll]);

  const loadHostConfig = useCallback(
    async (hostId: string, hostName: string): Promise<HostAlertConfig> => {
      const cfg = await loadAlertConfig(hostId, hostName);
      if (mountedRef.current) {
        setConfigs((prev) => ({ ...prev, [hostId]: cfg }));
      }
      return cfg;
    },
    [],
  );

  const saveHostConfig = useCallback(
    async (config: HostAlertConfig) => {
      const updated = { ...config, updatedAt: new Date().toISOString() };
      await saveAlertConfig(updated);
      if (mountedRef.current) {
        setConfigs((prev) => ({ ...prev, [config.hostId]: updated }));
      }
    },
    [],
  );

  const evaluateAlerts = useCallback(
    (
      hostId: string,
      hostName: string,
      metrics: Array<{
        metric: string;
        metricLabel: string;
        currentValue: number;
        forecastedValue: number;
        daysToThreshold: number | null;
      }>,
    ): EvaluatedAlert[] => {
      const config = configs[hostId];
      if (!config) return [];

      const alerts: EvaluatedAlert[] = [];

      for (const m of metrics) {
        const threshold = config.thresholds.find((t) => t.metric === m.metric && t.enabled);
        if (!threshold) continue;

        const valueToCheck = m.forecastedValue > 0 ? m.forecastedValue : m.currentValue;

        if (valueToCheck >= threshold.criticalPct) {
          alerts.push({
            hostId,
            hostName,
            metric: m.metric,
            metricLabel: m.metricLabel,
            currentValue: m.currentValue,
            forecastedValue: m.forecastedValue,
            thresholdPct: threshold.criticalPct,
            severity: "critical",
            daysToThreshold: m.daysToThreshold,
            message: `${m.metricLabel} forecasted at ${m.forecastedValue.toFixed(1)}% exceeds critical threshold (${threshold.criticalPct}%)`,
          });
        } else if (valueToCheck >= threshold.warningPct) {
          alerts.push({
            hostId,
            hostName,
            metric: m.metric,
            metricLabel: m.metricLabel,
            currentValue: m.currentValue,
            forecastedValue: m.forecastedValue,
            thresholdPct: threshold.warningPct,
            severity: "warning",
            daysToThreshold: m.daysToThreshold,
            message: `${m.metricLabel} forecasted at ${m.forecastedValue.toFixed(1)}% approaching warning threshold (${threshold.warningPct}%)`,
          });
        }
      }

      return alerts;
    },
    [configs],
  );

  return {
    configs,
    isLoading,
    error,
    loadHostConfig,
    saveHostConfig,
    evaluateAlerts,
    refresh: loadAll,
  };
}
