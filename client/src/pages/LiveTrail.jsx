import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FaStop, FaLocationArrow, FaExclamationTriangle, FaCompass } from "react-icons/fa";
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
    return `${m}:${String(s).padStart(2, "0")} /km`;
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