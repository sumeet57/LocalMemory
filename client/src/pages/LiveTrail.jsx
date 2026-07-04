import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FaStop, FaLocationArrow, FaExclamationTriangle } from "react-icons/fa";
import TrailMap from "../components/TrailMap";
import { getSocket, disconnectSocket } from "../utils/socket.utils";

const PHASE = {
  INITIALIZING: "initializing",
  TRACKING: "tracking",
  STOPPING: "stopping",
  ERROR: "error",
};

const formatDuration = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const s = String(totalSeconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
};

const LiveTrail = () => {
  const navigate = useNavigate();

  const [phase, setPhase] = useState(PHASE.INITIALIZING);
  const [points, setPoints] = useState([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);

  const trailIdRef = useRef(null);
  const socketRef = useRef(null);
  const intervalRef = useRef(null);
  const watchIdRef = useRef(null);
  const latestFixRef = useRef(null); // most recent coordinate pushed by watchPosition
  const staleWarnedRef = useRef(false);
  const wakeLockRef = useRef(null);
  const startTimeRef = useRef(null);
  const isTrackingRef = useRef(false); // guards back-button/unload prompts

  // ---- Screen Wake Lock: keep the screen on (dimmed) while tracking ----
  const requestWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      }
    } catch (err) {
      // Non-fatal: some browsers / low battery states reject this.
      console.warn("Wake Lock request failed:", err);
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    try {
      await wakeLockRef.current?.release();
    } catch (_) {
      /* ignore */
    }
    wakeLockRef.current = null;
  }, []);

  // Re-acquire the wake lock if the tab regains visibility mid-trail
  useEffect(() => {
    const onVisibilityChange = async () => {
      if (
        document.visibilityState === "visible" &&
        isTrackingRef.current &&
        !wakeLockRef.current
      ) {
        await requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [requestWakeLock]);

  // ---- Navigation / refresh guard ----------------------------------------
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (!isTrackingRef.current) return;
      e.preventDefault();
      e.returnValue =
        "A trail is currently being recorded. Leaving now may interrupt live tracking.";
      return e.returnValue;
    };

    window.addEventListener("beforeunload", onBeforeUnload);

    // Intercept back-button gestures with a dummy history entry
    window.history.pushState({ trailGuard: true }, "");
    const onPopState = () => {
      if (!isTrackingRef.current) return;
      const confirmLeave = window.confirm(
        "You're still recording a live trail. Leave anyway? (Your progress so far is safe, but tracking will stop.)"
      );
      if (confirmLeave) {
        stopTracking(true);
      } else {
        window.history.pushState({ trailGuard: true }, "");
      }
    };
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("popstate", onPopState);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Elapsed time ticker ----
  useEffect(() => {
    if (phase !== PHASE.TRACKING) return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  // ---- Core: start the trail on mount ----
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setPhase(PHASE.ERROR);
      setErrorMsg("Geolocation is not supported on this device/browser.");
      return;
    }

    const socket = getSocket();
    socketRef.current = socket;

    socket.on("connect_error", () => {
      setPhase(PHASE.ERROR);
      setErrorMsg("Could not connect to the tracking server. Please sign in again.");
    });

    socket.on("trail:finalized", ({ trailId, reason }) => {
      if (trailId !== trailIdRef.current) return;
      isTrackingRef.current = false;
      toast.info(
        reason === "auto-inactivity"
          ? "No signal for 5 minutes — your trail was automatically saved."
          : "Trail saved."
      );
      cleanupAndNavigate(trailId);
    });

    const begin = () => {
      socket.emit("trail:start", {}, (res) => {
        if (!res?.ok) {
          setPhase(PHASE.ERROR);
          setErrorMsg(res?.error || "Could not start the trail.");
          return;
        }
        trailIdRef.current = res.trailId;
        startTimeRef.current = Date.now();
        isTrackingRef.current = true;
        setPhase(PHASE.TRACKING);
        requestWakeLock();
        startGeoCapture();
      });
    };

    if (socket.connected) {
      begin();
    } else {
      socket.once("connect", begin);
    }

    return () => {
      socket.off("trail:finalized");
      socket.off("connect_error");
      socket.off("connect", begin);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startGeoCapture = () => {
    // Let the browser/OS push fixes to us as they naturally become
    // available (this is the efficient, reliable way to use GPS —
    // forcing a brand new fix on demand every second is what was causing
    // the false "lost GPS" warnings, since most devices can't produce a
    // fresh fix that fast).
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        latestFixRef.current = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: Date.now(),
        };
        staleWarnedRef.current = false;
      },
      (err) => {
        console.error("Geolocation error:", err);
        if (err.code === err.PERMISSION_DENIED) {
          toast.warn("Location permission denied. Enable it to keep recording.");
        }
        // Other watch errors are transient (e.g. momentary signal dropout);
        // the staleness check below decides if it's actually worth warning
        // the user, so we don't spam a toast on every blip here.
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 15000,
      }
    );

    // Once per second: take whatever the latest known fix is, append it
    // to the local array (redraws the line) and stream it to the server.
    intervalRef.current = setInterval(() => {
      const point = latestFixRef.current;
      if (!point) return; // no fix yet at all — first one can take a moment

      const ageMs = Date.now() - point.timestamp;
      if (ageMs > 10000) {
        // No fresh fix in 10+ seconds — genuinely worth flagging once.
        if (!staleWarnedRef.current) {
          toast.warn("Lost GPS signal — trying to reconnect...");
          staleWarnedRef.current = true;
        }
        return;
      }

      setPoints((prev) => [...prev, point]);

      if (trailIdRef.current && socketRef.current) {
        socketRef.current.emit("trail:point", {
          trailId: trailIdRef.current,
          ...point,
        });
      }
    }, 1000);
  };

  const cleanupAndNavigate = (trailId) => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    releaseWakeLock();
    if (trailId) {
      navigate(`/trail/${trailId}`, { replace: true });
    } else {
      navigate("/", { replace: true });
    }
  };

  const stopTracking = (skipConfirm = false) => {
    if (!isTrackingRef.current) return;

    if (!skipConfirm) {
      const confirmStop = window.confirm("Stop and save this trail?");
      if (!confirmStop) return;
    }

    isTrackingRef.current = false;
    setPhase(PHASE.STOPPING);

    const trailId = trailIdRef.current;
    socketRef.current?.emit("trail:stop", { trailId }, () => {
      cleanupAndNavigate(trailId);
    });

    // Safety fallback in case the server doesn't ack in time
    setTimeout(() => cleanupAndNavigate(trailId), 4000);
  };

  useEffect(() => {
    return () => {
      // Component unmount safety net (e.g. programmatic navigation elsewhere)
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      releaseWakeLock();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === PHASE.ERROR) {
    return (
      <div className="min-h-screen bg-zinc-900 text-white flex flex-col items-center justify-center gap-4 p-6 text-center">
        <FaExclamationTriangle className="text-amber-500 text-4xl" />
        <p className="text-lg">{errorMsg}</p>
        <button
          className="bg-zinc-700 px-4 py-2 rounded-lg"
          onClick={() => navigate("/")}
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-zinc-900 text-white flex flex-col overflow-hidden">
      <div className="p-4 flex items-center justify-between bg-zinc-800 shadow-md z-10 shrink-0">
        <div className="flex items-center gap-2">
          <FaLocationArrow
            className={`text-amber-500 ${
              phase === PHASE.TRACKING ? "animate-pulse" : ""
            }`}
          />
          <div>
            <p className="font-semibold">
              {phase === PHASE.INITIALIZING
                ? "Starting live tracking..."
                : phase === PHASE.STOPPING
                ? "Saving trail..."
                : "Recording trail"}
            </p>
            <p className="text-xs text-zinc-400">
              {points.length} points &middot; {formatDuration(elapsedMs)}
            </p>
          </div>
        </div>

        <button
          disabled={phase !== PHASE.TRACKING}
          onClick={() => stopTracking(false)}
          className="flex items-center gap-2 bg-red-600 disabled:opacity-40 px-4 py-2 rounded-lg font-semibold"
        >
          <FaStop /> Stop Trail
        </button>
      </div>

      <div className="flex-1 min-h-0">
        <TrailMap points={points} live height="100%" />
      </div>
    </div>
  );
};

export default LiveTrail;
