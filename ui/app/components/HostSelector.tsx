import React, { useState, useMemo } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Paragraph } from "@dynatrace/strato-components/typography";
import { Select } from "@dynatrace/strato-components/forms";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import { useDql } from "@dynatrace-sdk/react-hooks";

type HostSelectorProps = {
  onSelect: (hostId: string, hostName: string) => void;
};

export const HostSelector = ({ onSelect }: HostSelectorProps) => {
  const [selectedHost, setSelectedHost] = useState<string | null>(null);

  const { data, isLoading, error } = useDql({
    query: `smartscapeNodes "HOST"
| fields id, name
| sort name asc
| limit 200`,
  });

  const hosts = useMemo(() => {
    if (!data?.records) return [];
    return data.records.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      name: (r["name"] as string) ?? (r.id as string),
    }));
  }, [data]);

  if (isLoading) {
    return (
      <Flex alignItems="center" gap={8}>
        <ProgressCircle size="small" />
        <Paragraph>Loading hosts…</Paragraph>
      </Flex>
    );
  }

  if (error) {
    return <Paragraph>Error loading hosts: {error.message}</Paragraph>;
  }

  return (
    <Select
      value={selectedHost}
      onChange={(value) => {
        const id = value as string;
        setSelectedHost(id);
        const host = hosts.find((h) => h.id === id);
        onSelect(id, host?.name ?? id);
      }}
    >
      <Select.Trigger placeholder="Select a host…" style={{ minWidth: 350 }} />
      <Select.Content>
        {hosts.map((h) => (
          <Select.Option key={h.id} value={h.id}>
            {h.name}
          </Select.Option>
        ))}
      </Select.Content>
    </Select>
  );
};
