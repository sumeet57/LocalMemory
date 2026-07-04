import Trail from "../models/trail.model.js";
import { totalDistance } from "../utils/geo.utils.js";

// ---------------------------------------------------------------------------
// In-memory session cache
// Each live trail gets an entry here. Incoming GPS points are buffered in
// RAM first (fast, no DB round-trip per point) and periodically flushed to
// MongoDB. If no new point arrives for INACTIVITY_MS, the trail is
// auto-finalized and whatever is left in the cache is committed to the DB.
// ---------------------------------------------------------------------------

const INACTIVITY_MS = 5 * 60 * 1000; // 5 minutes
const FLUSH_INTERVAL_MS = 15 * 1000; // periodic safety flush every 15s
const FLUSH_EVERY_N_POINTS = 20; // or flush immediately once buffer gets this big

/** trailId -> { userId, buffer: [], flushTimer, inactivityTimer, allPoints: [] } */
const liveTrails = new Map();

function clearTimers(session) {
  if (session.inactivityTimer) clearTimeout(session.inactivityTimer);
  if (session.flushTimer) clearInterval(session.flushTimer);
}

async function flushBuffer(trailId, { finalize = false } = {}) {
  const session = liveTrails.get(trailId);
  if (!session) return null;

  const pointsToCommit = session.buffer.splice(0, session.buffer.length);

  const update = {
    $set: { lastPointAt: new Date() },
  };

  if (pointsToCommit.length > 0) {
    update.$push = { points: { $each: pointsToCommit } };
    update.$inc = { pointCount: pointsToCommit.length };
  }

  if (finalize) {
    update.$set.status = "completed";
    update.$set.endedAt = new Date();
    update.$set.endReason = session.endReason || "manual";
    update.$set.distanceMeters = Math.round(
      totalDistance(session.allPoints)
    );
  }

  const trail = await Trail.findByIdAndUpdate(trailId, update, {
    new: true,
  });

  return trail;
}

function scheduleInactivityFinalize(trailId, onFinalize) {
  const session = liveTrails.get(trailId);
  if (!session) return;

  if (session.inactivityTimer) clearTimeout(session.inactivityTimer);

  session.inactivityTimer = setTimeout(async () => {
    try {
      session.endReason = "auto-inactivity";
      const trail = await flushBuffer(trailId, { finalize: true });
      clearTimers(session);
      liveTrails.delete(trailId);
      if (onFinalize) onFinalize(trail);
    } catch (err) {
      console.error("Auto-finalize error for trail", trailId, err);
    }
  }, INACTIVITY_MS);
}

/**
 * Start tracking a brand-new trail in memory. The Mongo document must
 * already exist (created by createTrail). Returns nothing; sets up buffers
 * and timers keyed by trailId.
 */
export function startLiveSession(trailId, userId, onFinalize) {
  const session = {
    userId: String(userId),
    buffer: [],
    allPoints: [],
    endReason: null,
    inactivityTimer: null,
    flushTimer: null,
  };

  // Safety-net periodic flush in case buffer never hits the count threshold
  session.flushTimer = setInterval(() => {
    flushBuffer(trailId).catch((err) =>
      console.error("Periodic flush error", trailId, err)
    );
  }, FLUSH_INTERVAL_MS);

  liveTrails.set(trailId, session);
  scheduleInactivityFinalize(trailId, onFinalize);
}

/**
 * Push a new GPS coordinate into the RAM buffer for a live trail.
 * Resets the 5-minute inactivity clock. Flushes to DB once the buffer
 * grows past a threshold.
 */
export async function pushPoint(trailId, userId, point, onFinalize) {
  const session = liveTrails.get(trailId);
  if (!session) {
    throw new Error("Trail session is not active or does not belong to you");
  }
  if (session.userId !== String(userId)) {
    throw new Error("Not authorized for this trail session");
  }

  session.buffer.push(point);
  session.allPoints.push(point);

  // Reset inactivity window every time real data arrives
  scheduleInactivityFinalize(trailId, onFinalize);

  if (session.buffer.length >= FLUSH_EVERY_N_POINTS) {
    await flushBuffer(trailId);
  }
}

/** Manual stop requested by the client ("Stop Trail" button). */
export async function stopLiveSession(trailId, userId) {
  const session = liveTrails.get(trailId);
  if (!session) {
    // Might already have been auto-finalized; just return current doc.
    return Trail.findById(trailId);
  }
  if (session.userId !== String(userId)) {
    throw new Error("Not authorized for this trail session");
  }

  session.endReason = "manual";
  const trail = await flushBuffer(trailId, { finalize: true });
  clearTimers(session);
  liveTrails.delete(trailId);
  return trail;
}

/** Is this trail currently being tracked live in memory? */
export function isLive(trailId) {
  return liveTrails.has(trailId);
}

/**
 * Called when the underlying socket disconnects (app closed / network
 * dropped). We intentionally do NOT finalize the trail here — GPS may come
 * back once the user regains signal deep in the forest. The 5-minute
 * inactivity timer (independent of socket connection state) is the only
 * thing that finalizes an abandoned trail, matching the spec's
 * "auto-commit on 5 minutes of silence" behaviour.
 */
export function handleDisconnect() {
  // no-op by design — see comment above
}
