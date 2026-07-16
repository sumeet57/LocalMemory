import { useCallback, useEffect, useRef, useState } from "react";
import { Geolocation } from "@capacitor/geolocation";
import { bearing, distanceMeters } from "../utils/geo.utils";

const STALE_WARNING_MS = 20000;
const MAX_REALISTIC_SPEED_MPS = 8;
const JUMP_CONFIRM_DISTANCE_M = 15;

export function useLiveGeolocation({ active = true, onAccepted } = {}) {
  const [position, setPosition] = useState(null);
  const [heading, setHeading] = useState(null);
  const [isStale, setIsStale] = useState(false);
  const [needsCompassPermission, setNeedsCompassPermission] = useState(false);

  const watchIdRef = useRef(null);
  const intervalRef = useRef(null);
  const latestFixRef = useRef(null);
  const lastAcceptedRef = useRef(null);
  const pendingJumpRef = useRef(null);
  const staleWarnedRef = useRef(false);
  const compassActiveRef = useRef(false);
  const orientationEventNameRef = useRef(null);
  const onAcceptedRef = useRef(onAccepted);
  onAcceptedRef.current = onAccepted;

  const handleOrientation = useCallback((event) => {
    let h;
    if (typeof event.webkitCompassHeading === "number") {
      h = event.webkitCompassHeading;
    } else if (typeof event.alpha === "number") {
      h = (360 - event.alpha) % 360;
    }
    if (typeof h === "number" && !Number.isNaN(h)) {
      compassActiveRef.current = true;
      setHeading(h);
    }
  }, []);

  const enableCompass = useCallback(async () => {
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      try {
        const result = await DeviceOrientationEvent.requestPermission();
        if (result === "granted") {
          const eventName =
            "ondeviceorientationabsolute" in window
              ? "deviceorientationabsolute"
              : "deviceorientation";
          window.addEventListener(eventName, handleOrientation, true);
          orientationEventNameRef.current = eventName;
        }
      } catch (err) {
        console.warn("Compass permission request failed:", err);
      } finally {
        setNeedsCompassPermission(false);
      }
    }
  }, [handleOrientation]);

  useEffect(() => {
    if (!active) return undefined;

    const requiresExplicitPermission =
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function";

    if (requiresExplicitPermission) {
      setNeedsCompassPermission(true);
    } else if (typeof window.DeviceOrientationEvent !== "undefined") {
      const eventName =
        "ondeviceorientationabsolute" in window
          ? "deviceorientationabsolute"
          : "deviceorientation";
      window.addEventListener(eventName, handleOrientation, true);
      orientationEventNameRef.current = eventName;
    }

    const startWatching = async () => {
      try {
        const id = await Geolocation.watchPosition(
          { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
          (pos) => {
            if (!pos) return;
            latestFixRef.current = {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              heading:
                typeof pos.coords.heading === "number" &&
                !Number.isNaN(pos.coords.heading)
                  ? pos.coords.heading
                  : null,
              timestamp: Date.now(),
            };
            staleWarnedRef.current = false;
          }
        );
        watchIdRef.current = id;
      } catch (err) {
        console.error("Geolocation watch failed:", err);
      }
    };

    startWatching();

    intervalRef.current = setInterval(() => {
      const fix = latestFixRef.current;
      if (!fix) return;

      const ageMs = Date.now() - fix.timestamp;
      if (ageMs > STALE_WARNING_MS) {
        if (!staleWarnedRef.current) {
          setIsStale(true);
          staleWarnedRef.current = true;
        }
        return;
      }
      setIsStale(false);

      const prev = lastAcceptedRef.current;
      let accepted = fix;

      if (prev) {
        const dist = distanceMeters(prev, fix);
        const dtSec = Math.max((fix.timestamp - prev.timestamp) / 1000, 1);
        const speed = dist / dtSec;
        const tolerance = Math.max(prev.accuracy || 0, fix.accuracy || 0) / 8;
        const plausible = speed <= MAX_REALISTIC_SPEED_MPS + tolerance;

        if (!plausible) {
          if (
            pendingJumpRef.current &&
            distanceMeters(pendingJumpRef.current, fix) < JUMP_CONFIRM_DISTANCE_M
          ) {
            pendingJumpRef.current = null;
          } else {
            pendingJumpRef.current = fix;
            accepted = null;
          }
        } else {
          pendingJumpRef.current = null;
        }
      }

      if (!accepted) return;

      if (!compassActiveRef.current) {
        if (accepted.heading !== null) {
          setHeading(accepted.heading);
        } else if (prev) {
          const moved = distanceMeters(prev, accepted);
          if (moved > 2) setHeading(bearing(prev, accepted));
        }
      }

      lastAcceptedRef.current = accepted;
      setPosition({
        lat: accepted.lat,
        lng: accepted.lng,
        accuracy: accepted.accuracy,
      });
      onAcceptedRef.current?.(accepted);
    }, 1000);

    return () => {
      if (watchIdRef.current !== null) {
        Geolocation.clearWatch({ id: watchIdRef.current }).catch(err => console.error(err));
        watchIdRef.current = null;
      }
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (orientationEventNameRef.current) {
        window.removeEventListener(
          orientationEventNameRef.current,
          handleOrientation,
          true
        );
        orientationEventNameRef.current = null;
      }
    };
  }, [active, handleOrientation]);

  return { position, heading, isStale, needsCompassPermission, enableCompass };
}