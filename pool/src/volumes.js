/**
 * Volume lifecycle: create with retry, query, and cleanup.
 *
 * Depends on railway.js for low-level GraphQL (createVolume, gql).
 */

import { createVolume, gql } from "./railway.js";

/** Try to create a volume for a service. Returns true on success. */
export async function ensureVolume(serviceId) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const vol = await createVolume(serviceId, "/data");
      console.log(`[volumes] Created: ${vol.id}`);
      return true;
    } catch (err) {
      console.warn(`[volumes] Attempt ${attempt}/3 failed for ${serviceId}:`, err.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return false;
}

/** Fetch all project volumes grouped by serviceId.
 *  Returns Map<serviceId, volumeId[]> or null on failure. */
export async function fetchAllVolumesByService() {
  const projectId = process.env.RAILWAY_PROJECT_ID;
  try {
    const data = await gql(
      `query($id: String!) {
        project(id: $id) {
          volumes {
            edges {
              node {
                id
                volumeInstances { edges { node { serviceId } } }
              }
            }
          }
        }
      }`,
      { id: projectId }
    );
    const map = new Map();
    for (const edge of data.project?.volumes?.edges || []) {
      const vol = edge.node;
      for (const vi of vol.volumeInstances?.edges || []) {
        const sid = vi.node?.serviceId;
        if (sid) {
          if (!map.has(sid)) map.set(sid, []);
          map.get(sid).push(vol.id);
        }
      }
    }
    return map;
  } catch (err) {
    console.warn(`[volumes] fetchAllVolumesByService failed: ${err.message}`);
    return null;
  }
}

/** Delete orphaned agent volumes (not attached to any current agent service).
 *  Only touches volumes mounted at /data on convos-agent-* services. */
export async function deleteOrphanAgentVolumes() {
  const projectId = process.env.RAILWAY_PROJECT_ID;
  try {
    const data = await gql(
      `query($id: String!) {
        project(id: $id) {
          volumes {
            edges {
              node {
                id
                name
                volumeInstances {
                  edges { node { serviceId mountPath } }
                }
              }
            }
          }
          services(first: 500) {
            edges { node { id name } }
          }
        }
      }`,
      { id: projectId }
    );

    // Build set of active service IDs
    const activeServiceIds = new Set(
      (data.project?.services?.edges || []).map((e) => e.node.id)
    );

    const volumes = data.project?.volumes?.edges || [];
    let deleted = 0;

    for (const edge of volumes) {
      const vol = edge.node;
      const instances = vol.volumeInstances?.edges || [];

      // Skip volumes not mounted at /data (e.g. Postgres, MySQL volumes)
      const isAgentVolume = instances.some((vi) => vi.node?.mountPath === "/data");
      if (!isAgentVolume && instances.length > 0) continue;

      // Orphan = no instances at all, or attached to a service that no longer exists
      const isOrphan = instances.length === 0 ||
        instances.every((vi) => !activeServiceIds.has(vi.node?.serviceId));

      if (isOrphan) {
        await deleteVolume(vol.id, "(orphan)");
        deleted++;
      }
    }

    if (deleted === 0) {
      console.log(`[volumes] No orphan agent volumes found`);
    } else {
      console.log(`[volumes] Cleaned up ${deleted} orphan volume(s)`);
    }
  } catch (err) {
    console.warn(`[volumes] deleteOrphanAgentVolumes failed: ${err.message}`);
  }
}

/** Delete a single volume by ID. Best-effort. */
export async function deleteVolume(volumeId, serviceId) {
  try {
    await gql(`mutation($volumeId: String!) { volumeDelete(volumeId: $volumeId) }`, { volumeId });
    console.log(`[volumes] Deleted ${volumeId} (was attached to ${serviceId})`);
  } catch (err) {
    console.warn(`[volumes] Failed to delete ${volumeId}: ${err.message}`);
  }
}
