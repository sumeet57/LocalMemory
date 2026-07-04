import { Server } from "socket.io";
import User from "../models/user.model.js";
import Trail from "../models/trail.model.js";
import { hashSessionId } from "../utils/auth/session.utils.js";
import {
  pushPoint,
  startLiveSession,
  stopLiveSession,
  handleDisconnect,
} from "../services/trail.service.js";

// Reuses the exact same "x-session-id" session mechanism as the REST API,
// so a logged-in browser tab is automatically authenticated on the socket
// too — no separate login step needed.
async function socketSessionAuth(socket, next) {
  try {
    const rawSessionId =
      socket.handshake.auth?.sessionId ||
      socket.handshake.headers["x-session-id"];

    if (!rawSessionId) {
      return next(new Error("Session missing"));
    }

    const hashed = hashSessionId(rawSessionId);
    const user = await User.findOne({
      sessions: { $elemMatch: { sessionIdHash: hashed } },
    }).lean();

    if (!user) {
      return next(new Error("Invalid session"));
    }

    socket.userId = String(user._id);
    return next();
  } catch (err) {
    console.error("Socket auth error:", err);
    return next(new Error("Authentication failed"));
  }
}

function validPoint(payload) {
  if (!payload) return false;
  const { lat, lng } = payload;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function initSocket(httpServer, allowedOrigin) {
  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigin,
      credentials: true,
    },
  });

  io.use(socketSessionAuth);

  io.on("connection", (socket) => {
    // A user can have multiple tabs/devices; room lets us push finalize
    // events to every connection watching this user's trails.
    socket.join(`user:${socket.userId}`);

    // ---- Start a brand new trail --------------------------------------
    socket.on("trail:start", async (_payload, ack) => {
      try {
        const trail = await Trail.create({
          user: socket.userId,
          status: "active",
          startedAt: new Date(),
        });

        const trailId = String(trail._id);
        socket.currentTrailId = trailId;

        startLiveSession(trailId, socket.userId, (finalizedTrail) => {
          io.to(`user:${socket.userId}`).emit("trail:finalized", {
            trailId,
            reason: finalizedTrail?.endReason || "auto-inactivity",
            trail: finalizedTrail,
          });
        });

        if (typeof ack === "function") {
          ack({ ok: true, trailId, startedAt: trail.startedAt });
        }
      } catch (err) {
        console.error("trail:start error:", err);
        if (typeof ack === "function") {
          ack({ ok: false, error: "Could not start trail" });
        }
      }
    });

    // ---- Stream a GPS coordinate ---------------------------------------
    socket.on("trail:point", async (payload, ack) => {
      try {
        const { trailId, lat, lng, accuracy, timestamp } = payload || {};

        if (!trailId || !validPoint(payload)) {
          if (typeof ack === "function") {
            ack({ ok: false, error: "Invalid point payload" });
          }
          return;
        }

        await pushPoint(
          trailId,
          socket.userId,
          {
            lat,
            lng,
            accuracy: typeof accuracy === "number" ? accuracy : undefined,
            timestamp: timestamp ? new Date(timestamp) : new Date(),
          },
          (finalizedTrail) => {
            io.to(`user:${socket.userId}`).emit("trail:finalized", {
              trailId,
              reason: finalizedTrail?.endReason || "auto-inactivity",
              trail: finalizedTrail,
            });
          }
        );

        if (typeof ack === "function") ack({ ok: true });
      } catch (err) {
        if (typeof ack === "function") {
          ack({ ok: false, error: err.message });
        }
      }
    });

    // ---- Manual stop -----------------------------------------------------
    socket.on("trail:stop", async (payload, ack) => {
      try {
        const { trailId } = payload || {};
        if (!trailId) {
          if (typeof ack === "function")
            ack({ ok: false, error: "trailId required" });
          return;
        }

        const trail = await stopLiveSession(trailId, socket.userId);
        if (typeof ack === "function") ack({ ok: true, trail });
      } catch (err) {
        if (typeof ack === "function") {
          ack({ ok: false, error: err.message });
        }
      }
    });

    // Network drop / app closed. We deliberately do NOT end the trail here;
    // the 5-minute inactivity timer in trail.service.js owns that decision.
    socket.on("disconnect", () => {
      handleDisconnect(socket.currentTrailId);
    });
  });

  return io;
}
