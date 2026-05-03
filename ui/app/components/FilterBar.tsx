/**
 * FilterBar - Standard Dynatrace filter bar for Capacity Planner
 * Uses FilterField for host filtering + TimeframeSelector for time range
 */

import React, { useCallback, useMemo } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { RefreshIcon } from "@dynatrace/strato-icons";
import {
  FilterField,
  TimeframeSelector,
  type FilterFieldValidatorMap,
} from "@dynatrace/strato-components/filters";
import type { Timeframe } from "@dynatrace/strato-components/core";
import { Text } from "@dynatrace/strato-components/typography";

export interface HostOption {
  entityId: string;
  entityName: string;
}

interface FilterBarProps {
  timeframe: Timeframe | null;
  filterQuery: string;
  onTimeframeChange: (timeframe: Timeframe | null) => void;
  onHostSelect: (hostId: string, hostName: string) => void;
  onFilterQueryChange: (query: string) => void;
  onRefresh?: () => void;
  isLoading?: boolean;
  availableHosts?: HostOption[];
}

interface FilterTree {
  children?: FilterNode[];
  key?: { value?: string };
  value?: { value?: string };
}

interface FilterNode {
  key?: { value?: string };
  value?: { value?: string };
  children?: FilterNode[];
}

const extractHostFromTree = (tree: FilterTree | null, nameToIdMap: Map<string, string>): string => {
  if (!tree) return "";
  const processNode = (node: FilterNode): string => {
    if (node.key?.value?.toLowerCase() === "host" && node.value?.value) {
      return nameToIdMap.get(node.value.value) || node.value.value;
    }
    if (node.children) {
      for (const child of node.children) {
        const result = processNode(child);
        if (result) return result;
      }
    }
    return "";
  };
  if (tree.children) {
    for (const child of tree.children) {
      const result = processNode(child);
      if (result) return result;
    }
  }
  return "";
};

export const FilterBar: React.FC<FilterBarProps> = ({
  timeframe,
  filterQuery,
  onTimeframeChange,
  onHostSelect,
  onFilterQueryChange,
  onRefresh,
  isLoading = false,
  availableHosts = [],
}) => {
  const nameToIdMap = useMemo(() => {
    const map = new Map<string, string>();
    availableHosts.forEach((h) => map.set(h.entityName, h.entityId));
    return map;
  }, [availableHosts]);

  const validatorMap = useMemo<FilterFieldValidatorMap>(
    () => ({
      keyPredicates: {
        host: {
          operators: ["equals", "not-equals"],
          valuePredicate:
            availableHosts.length > 0
              ? availableHosts.map((h) => h.entityName)
              : { type: "String" as const },
        },
      },
      exhaustive: false,
    }),
    [availableHosts]
  );

  const handleFilter = useCallback(
    (filterState: { value: string; syntaxTree: unknown; isValid: boolean }) => {
      onFilterQueryChange(filterState.value);
      const hostId = extractHostFromTree(filterState.syntaxTree as FilterTree, nameToIdMap);
      if (hostId) {
        const host = availableHosts.find((h) => h.entityId === hostId);
        onHostSelect(hostId, host?.entityName ?? hostId);
      }
    },
    [onFilterQueryChange, onHostSelect, nameToIdMap, availableHosts]
  );

  const handleChange = useCallback(
    (value: string) => {
      onFilterQueryChange(value);
    },
    [onFilterQueryChange]
  );

  const handleTimeframeChange = useCallback(
    (tf: Timeframe | null) => {
      if (tf) onTimeframeChange(tf);
    },
    [onTimeframeChange]
  );

  return (
    <Flex alignItems="center" gap={16} style={{ width: "100%", padding: "8px 0" }}>
      <Flex style={{ flex: 1, minWidth: 300 }}>
        <FilterField
          value={filterQuery}
          onChange={handleChange}
          onFilter={handleFilter}
          validatorMap={validatorMap}
          autoSuggestions
          placeholder="Filter by host (e.g., host=myserver01)"
        />
      </Flex>

      <TimeframeSelector
        value={timeframe}
        onChange={handleTimeframeChange}
      />

      {onRefresh && (
        <Button variant="default" onClick={onRefresh} disabled={isLoading}>
          <Flex alignItems="center" gap={4}>
            <RefreshIcon />
            <Text>Refresh</Text>
          </Flex>
        </Button>
      )}
    </Flex>
  );
};
