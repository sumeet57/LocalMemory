import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FaStop, FaLocationArrow, FaExclamationTriangle, FaCompass } from "react-icons/fa";
import TrailMap from "../components/TrailMap";
import { getSocket } from "../utils/socket.utils";
import { totalDistance } from "../utils/geo.utils";
import { useLiveGeolocation } from "../hooks/useLiveGeolocation";

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
  const wakeLockRef = useRef(null);
  const startTimeRef = useRef(null);
  const isTrackingRef = useRef(false); // guards back-button/unload prompts
  const staleToastShownRef = useRef(false);

  // Every accepted GPS fix (already outlier-filtered) lands here — build the
  // breadcrumb array and stream it to the server.
  const handleAccepted = useCallback((point) => {
    setPoints((prev) => [...prev, point]);

    if (trailIdRef.current && socketRef.current) {
      socketRef.current.emit("trail:point", {
        trailId: trailIdRef.current,
        lat: point.lat,
        lng: point.lng,
        accuracy: point.accuracy,
        timestamp: point.timestamp,
      });
    }
  }, []);

  const {
    position: livePosition,
    heading,
    isStale,
    needsCompassPermission,
    enableCompass,
  } = useLiveGeolocation({
    active: phase === PHASE.TRACKING,
    onAccepted: handleAccepted,
  });

  // Surface GPS staleness as a toast (hook only exposes the boolean)
  useEffect(() => {
    if (isStale && !staleToastShownRef.current) {
      staleToastShownRef.current = true;
      toast.warn("Lost GPS signal — trying to reconnect...");
    } else if (!isStale) {
      staleToastShownRef.current = false;
    }
  }, [isStale]);

  // ---- Screen Wake Lock: keep the screen on (dimmed) while tracking ----
  const requestWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      }
    } catch (err) {
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

  const distanceKm = useMemo(() => totalDistance(points) / 1000, [points]);
  const paceLabel = useMemo(() => {
    if (distanceKm < 0.05 || elapsedMs < 5000) return "—";
    const minutesPerKm = elapsedMs / 60000 / distanceKm;
    const m = Math.floor(minutesPerKm);
    const s = Math.round((minutesPerKm - m) * 60);
    return `${m}:${String(s).padStart(2, "0")} /km`;
  }, [distanceKm, elapsedMs]);

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

  const cleanupAndNavigate = (trailId) => {
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
              {distanceKm > 0 && (
                <>
                  {" "}
                  &middot; {distanceKm.toFixed(2)} km &middot; {paceLabel}
                </>
              )}
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

      <div className="flex-1 min-h-0 relative">
        <TrailMap
          points={points}
          liveLocation={livePosition}
          heading={heading}
          followByDefault
          height="100%"
        />

        {needsCompassPermission && (
          <button
            onClick={enableCompass}
            className="absolute top-3 left-3 z-[1000] bg-white/95 text-zinc-800 text-sm font-medium px-3 py-2 rounded-lg shadow-lg flex items-center gap-2"
          >
            <FaCompass className="text-blue-600" /> Enable compass
          </button>
        )}
      </div>
    </div>
  );
};

export default LiveTrail;
