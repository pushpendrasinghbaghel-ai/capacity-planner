// ============================================================
// useForecastSnapshots — React hook for forecast accuracy tracking
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import type { ForecastSnapshot } from "../types";
import {
  saveForecastSnapshot,
  loadForecastSnapshots,
  updateSnapshotActual,
} from "../lib/documents";
import { useDql } from "@dynatrace-sdk/react-hooks";

interface UseForecastSnapshotsResult {
  snapshots: ForecastSnapshot[];
  isLoading: boolean;
  error: string | null;
  /** Save a new forecast prediction snapshot */
  saveSnapshot: (snapshot: ForecastSnapshot) => Promise<string>;
  /** Fill in the actual value for a past snapshot */
  resolveSnapshot: (snapshotId: string, actualValue: number) => Promise<void>;
  /** Overall accuracy rate across all resolved snapshots */
  overallAccuracyPct: number | null;
  /** Within-band rate across all resolved snapshots */
  withinBandRate: number | null;
  /** Reload snapshots from Document Store */
  refresh: () => void;
}

export function useForecastSnapshots(): UseForecastSnapshotsResult {
  const [snapshots, setSnapshots] = useState<ForecastSnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await loadForecastSnapshots();
      if (mountedRef.current) {
        setSnapshots(data);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Failed to load snapshots");
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

  const saveSnapshot = useCallback(
    async (snapshot: ForecastSnapshot): Promise<string> => {
      const docId = await saveForecastSnapshot(snapshot);
      if (mountedRef.current) {
        setSnapshots((prev) => [snapshot, ...prev]);
      }
      return docId;
    },
    [],
  );

  const resolveSnapshot = useCallback(
    async (snapshotId: string, actualValue: number) => {
      await updateSnapshotActual(snapshotId, actualValue);
      if (mountedRef.current) {
        setSnapshots((prev) =>
          prev.map((s) => {
            if (s.id !== snapshotId) return s;
            const accuracyPct = Math.max(
              0,
              100 - (Math.abs(s.predictedValue - actualValue) / Math.max(actualValue, 0.01)) * 100,
            );
            return {
              ...s,
              actualValue,
              accuracyPct,
              withinBand: actualValue >= s.predictedLower && actualValue <= s.predictedUpper,
            };
          }),
        );
      }
    },
    [],
  );

  const resolved = snapshots.filter((s) => s.accuracyPct !== null);
  const overallAccuracyPct =
    resolved.length > 0
      ? resolved.reduce((sum, s) => sum + (s.accuracyPct ?? 0), 0) / resolved.length
      : null;

  const withinBandRate =
    resolved.length > 0
      ? (resolved.filter((s) => s.withinBand === true).length / resolved.length) * 100
      : null;

  return {
    snapshots,
    isLoading,
    error,
    saveSnapshot,
    resolveSnapshot,
    overallAccuracyPct,
    withinBandRate,
    refresh: load,
  };
}
