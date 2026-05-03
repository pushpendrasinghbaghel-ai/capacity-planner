// ============================================================
// Document Store Service Layer — Capacity Planner
// ============================================================
// Typed helpers for CRUD on three document types:
//   - capacity-forecast-snapshot (one accumulator document)
//   - capacity-plan (one document per plan)
//   - capacity-simulation (one document per simulation)
// ============================================================

import { documentsClient } from "@dynatrace-sdk/client-document";
import type { Binary } from "@dynatrace-sdk/http-client";
import type {
  ForecastSnapshot,
  ForecastSnapshotDocument,
  CapacityPlan,
  CapacityPlanDocument,
  SavedSimulation,
  SavedSimulationDocument,
} from "../types";

const DOC_TYPE_SNAPSHOT = "capacity-forecast-snapshot";
const DOC_TYPE_PLAN = "capacity-plan";
const DOC_TYPE_SIMULATION = "capacity-simulation";
const SNAPSHOT_DOC_NAME = "capacity-forecast-snapshots";

// ============================================================
// Internal helpers
// ============================================================

/** Parse the binary content returned by getDocument into a typed object. */
async function parseDocumentContent<T>(content: Binary | undefined): Promise<T | null> {
  if (!content) return null;
  const text = await content.get("text");
  return JSON.parse(text) as T;
}

/** Create a Blob from a JSON-serialisable value. */
function toBlob(value: unknown): Blob {
  return new Blob([JSON.stringify(value)], { type: "application/json" });
}

// ============================================================
// Forecast Snapshots
// ============================================================

/**
 * Find the existing snapshots accumulator document, if any.
 * Returns `{ id, version }` or `null`.
 */
async function findSnapshotDocument(): Promise<{ id: string; version: string } | null> {
  try {
    const list = await documentsClient.listDocuments({
      filter: `type == '${DOC_TYPE_SNAPSHOT}' and name == '${SNAPSHOT_DOC_NAME}'`,
      sort: "-modificationInfo.lastModifiedTime",
      pageSize: 1,
    });
    if (list.documents.length === 0) return null;
    const doc = list.documents[0];
    return { id: doc.id, version: doc.version };
  } catch {
    return null;
  }
}

/**
 * Save a forecast snapshot to the Document Store.
 *
 * Uses the append pattern: a single document accumulates all snapshots.
 * If the document doesn't exist yet it is created; otherwise the snapshot
 * is appended and the document is updated.
 *
 * @returns The document ID holding the snapshots.
 */
export async function saveForecastSnapshot(snapshot: ForecastSnapshot): Promise<string> {
  const existing = await findSnapshotDocument();

  if (existing) {
    // Fetch current snapshots, append, update
    const response = await documentsClient.getDocument({ id: existing.id });
    const doc = await parseDocumentContent<ForecastSnapshotDocument>(response.content);
    const snapshots = doc?.snapshots ?? [];
    snapshots.push(snapshot);

    const updated: ForecastSnapshotDocument = {
      type: DOC_TYPE_SNAPSHOT,
      version: 1,
      snapshots,
    };

    await documentsClient.updateDocument({
      id: existing.id,
      optimisticLockingVersion: existing.version,
      body: { content: toBlob(updated) },
    });

    return existing.id;
  }

  // First snapshot — create the accumulator document
  const doc: ForecastSnapshotDocument = {
    type: DOC_TYPE_SNAPSHOT,
    version: 1,
    snapshots: [snapshot],
  };

  const meta = await documentsClient.createDocument({
    body: {
      name: SNAPSHOT_DOC_NAME,
      type: DOC_TYPE_SNAPSHOT,
      content: toBlob(doc),
    },
  });

  return meta.id;
}

/**
 * Load all saved forecast snapshots from the Document Store.
 *
 * Finds the latest accumulator document and returns its snapshots array.
 * Returns an empty array if no snapshots document exists.
 */
export async function loadForecastSnapshots(): Promise<ForecastSnapshot[]> {
  try {
    const ref = await findSnapshotDocument();
    if (!ref) return [];

    const response = await documentsClient.getDocument({ id: ref.id });
    const doc = await parseDocumentContent<ForecastSnapshotDocument>(response.content);
    return doc?.snapshots ?? [];
  } catch {
    return [];
  }
}

/**
 * Update a snapshot with actual observed values and compute accuracy.
 *
 * Loads all snapshots, finds the one matching `snapshotId`, fills in
 * `actualValue`, `accuracyPct`, and `withinBand`, then persists the update.
 *
 * @param snapshotId - The `id` field of the target ForecastSnapshot.
 * @param actualValue - The observed metric value at the forecast target date.
 */
export async function updateSnapshotActual(snapshotId: string, actualValue: number): Promise<void> {
  const ref = await findSnapshotDocument();
  if (!ref) return;

  const response = await documentsClient.getDocument({ id: ref.id });
  const doc = await parseDocumentContent<ForecastSnapshotDocument>(response.content);
  if (!doc) return;

  const snapshot = doc.snapshots.find((s) => s.id === snapshotId);
  if (!snapshot) return;

  snapshot.actualValue = actualValue;
  snapshot.accuracyPct = Math.max(
    0,
    100 - (Math.abs(snapshot.predictedValue - actualValue) / Math.max(actualValue, 0.01)) * 100,
  );
  snapshot.withinBand =
    actualValue >= snapshot.predictedLower && actualValue <= snapshot.predictedUpper;

  await documentsClient.updateDocument({
    id: ref.id,
    optimisticLockingVersion: response.metadata?.version ?? ref.version,
    body: { content: toBlob(doc) },
  });
}

// ============================================================
// Capacity Plans
// ============================================================

/**
 * Save a new capacity plan to the Document Store.
 *
 * Each plan is stored as a separate document with type `capacity-plan`.
 *
 * @returns The document ID of the newly created plan.
 */
export async function saveCapacityPlan(plan: CapacityPlan): Promise<string> {
  const doc: CapacityPlanDocument = {
    type: DOC_TYPE_PLAN,
    version: 1,
    plan,
  };

  const meta = await documentsClient.createDocument({
    body: {
      name: plan.name,
      type: DOC_TYPE_PLAN,
      content: toBlob(doc),
    },
  });

  return meta.id;
}

/**
 * List all saved capacity plans (metadata only).
 *
 * Sorted by creation time descending (newest first).
 */
export async function listCapacityPlans(): Promise<
  Array<{ id: string; name: string; createdAt: string }>
> {
  try {
    const list = await documentsClient.listDocuments({
      filter: `type == '${DOC_TYPE_PLAN}'`,
      sort: "-modificationInfo.createdTime",
      pageSize: 100,
    });

    return list.documents.map((d) => ({
      id: d.id,
      name: d.name,
      createdAt: d.modificationInfo.createdTime.toISOString(),
    }));
  } catch {
    return [];
  }
}

/**
 * Load a capacity plan by its document ID.
 *
 * @returns The parsed CapacityPlan, or `null` if not found.
 */
export async function loadCapacityPlan(documentId: string): Promise<CapacityPlan | null> {
  try {
    const response = await documentsClient.getDocument({ id: documentId });
    const doc = await parseDocumentContent<CapacityPlanDocument>(response.content);
    return doc?.plan ?? null;
  } catch {
    return null;
  }
}

/**
 * Delete a capacity plan document.
 *
 * Fetches the document first to obtain the current version for
 * optimistic locking.
 */
export async function deleteCapacityPlan(documentId: string): Promise<void> {
  const response = await documentsClient.getDocument({ id: documentId });
  const version = response.metadata?.version;
  if (!version) return;

  await documentsClient.deleteDocument({
    id: documentId,
    optimisticLockingVersion: version,
  });
}

// ============================================================
// Saved Simulations
// ============================================================

/**
 * Save a simulation result to the Document Store.
 *
 * Each simulation is stored as a separate document with type `capacity-simulation`.
 *
 * @returns The document ID of the newly created simulation.
 */
export async function saveSimulation(simulation: SavedSimulation): Promise<string> {
  const doc: SavedSimulationDocument = {
    type: DOC_TYPE_SIMULATION,
    version: 1,
    simulation,
  };

  const meta = await documentsClient.createDocument({
    body: {
      name: simulation.scenarioName,
      type: DOC_TYPE_SIMULATION,
      content: toBlob(doc),
    },
  });

  return meta.id;
}

/**
 * List all saved simulations (metadata + scenario type).
 *
 * Because the scenario type is stored inside the document content, this
 * function fetches each document to extract it. For large numbers of
 * simulations a pagination / caching strategy should be considered.
 *
 * Sorted by creation time descending (newest first).
 */
export async function listSavedSimulations(): Promise<
  Array<{ id: string; name: string; savedAt: string; scenarioType: string }>
> {
  try {
    const list = await documentsClient.listDocuments({
      filter: `type == '${DOC_TYPE_SIMULATION}'`,
      sort: "-modificationInfo.createdTime",
      pageSize: 100,
    });

    const results = await Promise.all(
      list.documents.map(async (d) => {
        try {
          const response = await documentsClient.getDocument({ id: d.id });
          const doc = await parseDocumentContent<SavedSimulationDocument>(response.content);
          return {
            id: d.id,
            name: d.name,
            savedAt: d.modificationInfo.createdTime.toISOString(),
            scenarioType: doc?.simulation.scenarioType ?? "unknown",
          };
        } catch {
          return {
            id: d.id,
            name: d.name,
            savedAt: d.modificationInfo.createdTime.toISOString(),
            scenarioType: "unknown",
          };
        }
      }),
    );

    return results;
  } catch {
    return [];
  }
}

/**
 * Load a saved simulation by its document ID.
 *
 * @returns The parsed SavedSimulation, or `null` if not found.
 */
export async function loadSimulation(documentId: string): Promise<SavedSimulation | null> {
  try {
    const response = await documentsClient.getDocument({ id: documentId });
    const doc = await parseDocumentContent<SavedSimulationDocument>(response.content);
    return doc?.simulation ?? null;
  } catch {
    return null;
  }
}

/**
 * Delete a saved simulation document.
 *
 * Fetches the document first to obtain the current version for
 * optimistic locking.
 */
export async function deleteSimulation(documentId: string): Promise<void> {
  const response = await documentsClient.getDocument({ id: documentId });
  const version = response.metadata?.version;
  if (!version) return;

  await documentsClient.deleteDocument({
    id: documentId,
    optimisticLockingVersion: version,
  });
}
