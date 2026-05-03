/**
 * FilterContext - Global filter state that persists across pages
 * Provides consistent filtering experience matching Dynatrace UX standards
 */

import React, { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import type { Timeframe } from "@dynatrace/strato-components/core";

export interface FilterOptions {
  timeframe: Timeframe | null;
  filterQuery: string;
  hostFilter: string;
}

export const createDefaultTimeframe = (): Timeframe => ({
  from: { value: "now()-7d", type: "expression" as const, absoluteDate: new Date().toISOString() },
  to: { value: "now()", type: "expression" as const, absoluteDate: new Date().toISOString() },
});

export const DEFAULT_FILTERS: FilterOptions = {
  timeframe: createDefaultTimeframe(),
  filterQuery: "",
  hostFilter: "",
};

export const getTimeframeDqlClause = (timeframe: Timeframe | null): string => {
  if (!timeframe) return "from: now()-7d, to: now()";
  const fromValue = timeframe.from?.value || "now()-7d";
  const toValue = timeframe.to?.value || "now()";
  return `from: ${fromValue}, to: ${toValue}`;
};

export const getTimeframeForDavis = (timeframe: Timeframe | null): { startTime: string; endTime?: string } => {
  if (!timeframe) return { startTime: "now-7d" };
  const from = timeframe.from?.value || "now()-7d";
  // Convert DQL format now()-7d to Davis format now-7d
  const startTime = from.replace("now()", "now").replace("()", "");
  const to = timeframe.to?.value;
  if (to && to !== "now()") {
    return { startTime, endTime: to.replace("now()", "now").replace("()", "") };
  }
  return { startTime };
};

interface FilterContextValue {
  filters: FilterOptions;
  setFilters: (filters: FilterOptions) => void;
  updateFilter: <K extends keyof FilterOptions>(key: K, value: FilterOptions[K]) => void;
  resetFilters: () => void;
  timeframeDqlClause: string;
}

const FilterContext = createContext<FilterContextValue | null>(null);

export const FilterProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [filters, setFiltersState] = useState<FilterOptions>(DEFAULT_FILTERS);

  const setFilters = useCallback((newFilters: FilterOptions) => {
    setFiltersState(newFilters);
  }, []);

  const updateFilter = useCallback(<K extends keyof FilterOptions>(key: K, value: FilterOptions[K]) => {
    setFiltersState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState(DEFAULT_FILTERS);
  }, []);

  const timeframeDqlClause = useMemo(
    () => getTimeframeDqlClause(filters.timeframe),
    [filters.timeframe]
  );

  const value = useMemo<FilterContextValue>(
    () => ({ filters, setFilters, updateFilter, resetFilters, timeframeDqlClause }),
    [filters, setFilters, updateFilter, resetFilters, timeframeDqlClause]
  );

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
};

export const useGlobalFilters = (): FilterContextValue => {
  const context = useContext(FilterContext);
  if (!context) {
    throw new Error("useGlobalFilters must be used within a FilterProvider");
  }
  return context;
};
