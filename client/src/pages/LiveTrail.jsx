import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  FaStop,
  FaExclamationTriangle,
  FaCompass,
} from "react-icons/fa";
import { App } from "@capacitor/app";
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

const StatPill = ({ label, value }) => (
  <div className="flex flex-col items-center px-3">
    <span className="font-display font-bold text-ink text-base leading-none">
      {value}
    </span>
    <span className="text-[10px] uppercase tracking-wide text-ink-faint mt-1">
      {label}
    </span>
  </div>
);

const LiveTrail = () => {
  const navigate = useNavigate();

  const [phase, setPhase] = useState(PHASE.INITIALIZING);
  const [points, setPoints] = useState([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);

  const trailIdRef = useRef(null);
  const socketRef = useRef(null);
  const startTimeRef = useRef(null);
  const isTrackingRef = useRef(false);
  const staleToastShownRef = useRef(false);
  const wakeLockRef = useRef(null);

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

  useEffect(() => {
    if (isStale && !staleToastShownRef.current) {
      staleToastShownRef.current = true;
      toast.warn("Lost GPS signal — trying to reconnect...");
    } else if (!isStale) {
      staleToastShownRef.current = false;
    }
  }, [isStale]);

  // ---- Screen Wake Lock: keep the screen on (dimmed) while recording ----
  useEffect(() => {
    if (phase !== PHASE.TRACKING) return;

    const requestLock = async () => {
      try {
        if ("wakeLock" in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request("screen");
        }
      } catch (err) {
        console.warn("Wake Lock request failed:", err);
      }
    };
    requestLock();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !wakeLockRef.current) {
        requestLock();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [phase]);

  const cleanupAndNavigate = useCallback((trailId) => {
    if (trailId) {
      navigate(`/trail/${trailId}`, { replace: true });
    } else {
      navigate("/", { replace: true });
    }
  }, [navigate]);

  const stopTracking = useCallback((skipConfirm = false) => {
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

    setTimeout(() => cleanupAndNavigate(trailId), 4000);
  }, [cleanupAndNavigate]);

  useEffect(() => {
    const setupBackButtonGuard = async () => {
      const listener = await App.addListener("backButton", () => {
        if (!isTrackingRef.current) {
          navigate(-1);
          return;
        }
        const confirmLeave = window.confirm(
          "You're still recording a live trail. Leave anyway? (Your progress so far is safe, but tracking will stop.)"
        );
        if (confirmLeave) {
          stopTracking(true);
        }
      });
      return listener;
    };

    const backButtonListenerPromise = setupBackButtonGuard();

    const onBeforeUnload = (e) => {
      if (!isTrackingRef.current) return;
      e.preventDefault();
      e.returnValue = "A trail is currently being recorded. Leaving now may interrupt live tracking.";
      return e.returnValue;
    };

    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      backButtonListenerPromise.then((listener) => listener.remove());
    };
  }, [navigate, stopTracking]);

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
    return `${m}:${String(s).padStart(2, "0")}`;
  }, [distanceKm, elapsedMs]);

  useEffect(() => {
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
  }, [cleanupAndNavigate]);

  if (phase === PHASE.ERROR) {
    return (
      <div className="min-h-screen bg-canvas text-ink flex flex-col items-center justify-center gap-4 p-6 text-center">
        <FaExclamationTriangle className="text-accent text-4xl" />
        <p className="text-lg">{errorMsg}</p>
        <button
          className="bg-surface-2 border border-border px-5 py-2.5 rounded-full font-medium hover:bg-surface"
          onClick={() => navigate("/")}
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-canvas text-ink flex flex-col overflow-hidden">
      <div className="px-4 pt-4 pb-3 bg-surface border-b border-border shadow-lg z-10 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <span
              className={`relative flex h-2.5 w-2.5 ${
                phase === PHASE.TRACKING ? "" : "opacity-40"
              }`}
            >
              {phase === PHASE.TRACKING && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
              )}
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-accent" />
            </span>
            <p className="font-display font-semibold text-sm tracking-wide uppercase">
              {phase === PHASE.INITIALIZING
                ? "Starting..."
                : phase === PHASE.STOPPING
                ? "Saving trail..."
                : "Recording"}
            </p>
          </div>

          <button
            disabled={phase !== PHASE.TRACKING}
            onClick={() => stopTracking(false)}
            className="flex items-center gap-2 bg-ink text-canvas disabled:opacity-40 px-4 py-2 rounded-full font-semibold text-sm active:scale-95 transition"
          >
            <FaStop size={11} /> Stop
          </button>
        </div>

        <div className="flex items-center divide-x divide-border bg-canvas/60 rounded-xl py-2">
          <StatPill label="Time" value={formatDuration(elapsedMs)} />
          <StatPill label="Distance" value={`${distanceKm.toFixed(2)} km`} />
          <StatPill label="Pace /km" value={paceLabel} />
          <StatPill label="Points" value={points.length} />
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        <TrailMap
          points={points}
          liveLocation={livePosition}
          heading={heading}
          followByDefault
          navModeDefault
          height="100%"
        />

        {needsCompassPermission && phase === PHASE.TRACKING && (
          <div className="absolute inset-0 z-[1100] bg-canvas/90 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="bg-surface border border-border rounded-2xl p-6 max-w-xs w-full text-center shadow-2xl">
              <div className="w-14 h-14 rounded-full bg-accent/15 flex items-center justify-center mx-auto mb-4">
                <FaCompass className="text-accent text-2xl" />
              </div>
              <h3 className="font-display font-bold text-lg mb-1.5">
                Enable compass
              </h3>
              <p className="text-ink-muted text-sm mb-5">
                Lets the map rotate with you, navigation-style, and shows
                exactly which way you're facing.
              </p>
              <button
                onClick={enableCompass}
                className="w-full bg-accent hover:bg-accent-hover text-accent-ink font-semibold py-2.5 rounded-full transition"
              >
                Enable
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LiveTrail;
