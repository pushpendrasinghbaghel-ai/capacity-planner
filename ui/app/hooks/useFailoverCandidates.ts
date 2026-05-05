// ============================================================
// useFailoverCandidates — Service-aware failover analysis
// Traverses: HOST ← runs_on ← PROCESS_GROUP → instance_of → SERVICE
//            SERVICE ← instance_of ← PROCESS_GROUP → runs_on → HOST
// Returns: which services run on this host, and which other
//          hosts also serve those same services (real failover peers)
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { sanitizeEntityId } from "../utils/formatting";

export interface ServiceOnHost {
  serviceId: string;
  serviceName: string;
  /** Other hosts serving this same service */
  peerHosts: PeerHost[];
}

export interface PeerHost {
  hostId: string;
  hostName: string;
}

export interface FailoverAnalysis {
  /** Services running on the target host */
  services: ServiceOnHost[];
  /** Unique peer hosts across all services */
  uniquePeerHosts: PeerHost[];
  /** Services with zero peer hosts (single point of failure) */
  singlePointServices: ServiceOnHost[];
  /** Services with at least one peer host */
  redundantServices: ServiceOnHost[];
}

interface UseFailoverCandidatesResult {
  analysis: FailoverAnalysis | null;
  status: "idle" | "loading" | "success" | "error";
  error: string | null;
}

async function executeDql(query: string): Promise<Record<string, unknown>[]> {
  const response = await queryExecutionClient.queryExecute({
    body: { query, requestTimeoutMilliseconds: 20000, maxResultRecords: 500 },
  });
  if (response.state === "SUCCEEDED") {
    return (response.result?.records as Record<string, unknown>[]) ?? [];
  }
  if (response.requestToken) {
    let attempts = 0;
    while (attempts < 20) {
      await new Promise((r) => setTimeout(r, 1000));
      const poll = await queryExecutionClient.queryPoll({ requestToken: response.requestToken });
      if (poll.state === "SUCCEEDED") return (poll.result?.records as Record<string, unknown>[]) ?? [];
      if (poll.state === "FAILED" || poll.state === "CANCELLED") throw new Error(`Query ${poll.state}`);
      attempts++;
    }
  }
  return [];
}

export function useFailoverCandidates(hostId: string | null): UseFailoverCandidatesResult {
  const [analysis, setAnalysis] = useState<FailoverAnalysis | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const load = useCallback(async () => {
    if (!hostId) { setStatus("idle"); return; }
    const generation = ++generationRef.current;
    setStatus("loading");
    setError(null);

    try {
      const safeId = sanitizeEntityId(hostId);

      // Step 1: Find services running on this host
      // HOST ← (backward runs_on) ← PROCESS_GROUP → (forward instance_of) → SERVICE
      // Using smartscapeEdges approach for reliability
      const servicesOnHost = await executeDql(
        `smartscapeNodes "HOST"
| filter toString(id) == "${safeId}"
| traverse edgeTypes: {"runs_on"}, targetTypes: {"PROCESS_GROUP"}, direction: backward
| traverse edgeTypes: {"instance_of"}, targetTypes: {"SERVICE"}
| fields serviceId = toString(id), serviceName = name`
      );

      if (generation !== generationRef.current) return;

      if (servicesOnHost.length === 0) {
        // Fallback: try PROCESS instead of PROCESS_GROUP
        const servicesViaProcess = await executeDql(
          `smartscapeNodes "HOST"
| filter toString(id) == "${safeId}"
| traverse edgeTypes: {"runs_on"}, targetTypes: {"PROCESS_GROUP"}, direction: backward
| traverse edgeTypes: {"calls"}, targetTypes: {"SERVICE"}
| dedup serviceName = name
| fields serviceId = toString(id), serviceName = name`
        );

        if (generation !== generationRef.current) return;

        if (servicesViaProcess.length === 0) {
          setAnalysis({
            services: [],
            uniquePeerHosts: [],
            singlePointServices: [],
            redundantServices: [],
          });
          setStatus("success");
          return;
        }

        servicesOnHost.push(...servicesViaProcess);
      }

      // Deduplicate services
      const serviceMap = new Map<string, string>();
      for (const r of servicesOnHost) {
        const sid = r.serviceId as string;
        if (sid && !serviceMap.has(sid)) {
          serviceMap.set(sid, (r.serviceName as string) ?? sid);
        }
      }

      // Step 2: For each service, find other hosts also serving it
      // SERVICE ← (backward instance_of) ← PROCESS_GROUP → (forward runs_on) → HOST
      const services: ServiceOnHost[] = [];
      const allPeerHostMap = new Map<string, string>();

      for (const [serviceId, serviceName] of serviceMap) {
        const peerHostRecords = await executeDql(
          `smartscapeNodes "SERVICE"
| filter toString(id) == "${sanitizeEntityId(serviceId)}"
| traverse edgeTypes: {"instance_of"}, targetTypes: {"PROCESS_GROUP"}, direction: backward
| traverse edgeTypes: {"runs_on"}, targetTypes: {"HOST"}
| filter toString(id) != "${safeId}"
| dedup id
| fields hostId = toString(id), hostName = name`
        );

        if (generation !== generationRef.current) return;

        const peerHosts: PeerHost[] = [];
        for (const r of peerHostRecords) {
          const hid = r.hostId as string;
          const hname = (r.hostName as string) ?? hid;
          if (hid) {
            peerHosts.push({ hostId: hid, hostName: hname });
            if (!allPeerHostMap.has(hid)) allPeerHostMap.set(hid, hname);
          }
        }

        services.push({ serviceId, serviceName, peerHosts });
      }

      if (generation !== generationRef.current) return;

      const uniquePeerHosts = [...allPeerHostMap.entries()].map(([hostId, hostName]) => ({ hostId, hostName }));
      const singlePointServices = services.filter((s) => s.peerHosts.length === 0);
      const redundantServices = services.filter((s) => s.peerHosts.length > 0);

      setAnalysis({ services, uniquePeerHosts, singlePointServices, redundantServices });
      setStatus("success");
    } catch (err: unknown) {
      if (generation !== generationRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to analyze failover candidates");
      setStatus("error");
    }
  }, [hostId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { analysis, status, error };
}
