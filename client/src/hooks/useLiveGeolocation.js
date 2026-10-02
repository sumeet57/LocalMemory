import { useCallback, useEffect, useRef, useState } from "react";
import { Geolocation } from "@capacitor/geolocation";
import { bearing, distanceMeters } from "../utils/geo.utils";

// No fresh GPS signal in this long is worth telling the user about.
const STALE_WARNING_MS = 20000;

// A hiking/trail app has no business seeing walking speeds above this —
// anything faster almost certainly means the GPS chip spat out a bad fix.
const MAX_REALISTIC_SPEED_MPS = 8; // ~29 km/h
const JUMP_CONFIRM_DISTANCE_M = 15;

// A fix this imprecise (meters) is too noisy to move the displayed dot —
// we hold the last good position steady rather than let the dot jump
// around on a bad reading. Still accepted immediately for the very first
// fix, so the app doesn't sit blank waiting for a perfect signal.
const MAX_USABLE_ACCURACY_M = 100;

// Compass readings are throttled to this interval — raw deviceorientation
// events can fire 30-60x/second, far more than the UI needs, and smoothing
// on every single one wastes battery for no visual benefit.
const HEADING_UPDATE_INTERVAL_MS = 150;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// Shortest signed angular distance from a to b, in degrees (-180..180],
// so interpolating across the 0/360 wrap-around doesn't spin the wrong way.
function shortestAngleDelta(a, b) {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/**
 * Tracks the device's live position and facing direction, filtered and
 * smoothed for a steadier, more "Google Maps"-like feel:
 *
 * - Accuracy gating: a wildly imprecise fix doesn't yank the dot around —
 *   it's ignored in favor of the last trustworthy position.
 * - Accuracy-weighted smoothing: each accepted fix is blended with the
 *   previous position (more trust when accuracy is good, more smoothing
 *   when it's poor), instead of snapping straight to the raw coordinate.
 * - Outlier/jump rejection: an implausible instantaneous "teleport" is
 *   held back and only accepted if a second reading confirms it.
 * - Heading is smoothed the same way (shortest-path circular blend) and
 *   throttled, so the compass/cone doesn't jitter.
 *
 * `onAccepted(point)` fires once per second with the current smoothed
 * position — used by the recording page to build/send the breadcrumb
 * trail. The saved-trail viewer can ignore it and just use
 * `position`/`heading` for the overlay marker.
 */
export function useLiveGeolocation({ active = true, onAccepted } = {}) {
  const [position, setPosition] = useState(null);
  const [heading, setHeading] = useState(null);
  const [isStale, setIsStale] = useState(false);
  const [needsCompassPermission, setNeedsCompassPermission] = useState(false);

  const watchIdRef = useRef(null);
  const intervalRef = useRef(null);
  const lastFixReceivedAtRef = useRef(0);
  const lastRawFixRef = useRef(null); // raw, unsmoothed — used for jump/speed checks
  const smoothedPositionRef = useRef(null); // {lat, lng, accuracy} — what we display
  const smoothedHeadingRef = useRef(null);
  const pendingJumpRef = useRef(null);
  const staleWarnedRef = useRef(false);
  const compassActiveRef = useRef(false);
  const lastHeadingUpdateAtRef = useRef(0);
  const orientationEventNameRef = useRef(null);
  const onAcceptedRef = useRef(onAccepted);
  onAcceptedRef.current = onAccepted;

  const applySmoothedHeading = useCallback((rawHeading) => {
    const now = Date.now();
    if (now - lastHeadingUpdateAtRef.current < HEADING_UPDATE_INTERVAL_MS) return;
    lastHeadingUpdateAtRef.current = now;

    const prev = smoothedHeadingRef.current;
    const next =
      prev === null
        ? rawHeading
        : (prev + shortestAngleDelta(prev, rawHeading) * 0.35 + 360) % 360;

    smoothedHeadingRef.current = next;
    setHeading(next);
  }, []);

  const handleOrientation = useCallback(
    (event) => {
      let h;
      if (typeof event.webkitCompassHeading === "number") {
        // iOS Safari: already a compass bearing (0 = north, clockwise)
        h = event.webkitCompassHeading;
      } else if (typeof event.alpha === "number") {
        h = (360 - event.alpha) % 360;
      }
      if (typeof h === "number" && !Number.isNaN(h)) {
        compassActiveRef.current = true;
        applySmoothedHeading(h);
      }
    },
    [applySmoothedHeading]
  );

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

  // Runs for every raw GPS fix the OS hands us (as often as it's willing
  // to provide one) — this is what makes the live dot feel immediately
  // responsive rather than updating only once a second.
  const handleRawFix = useCallback((raw) => {
    lastFixReceivedAtRef.current = Date.now();
    staleWarnedRef.current = false;
    setIsStale(false);

    const prevRaw = lastRawFixRef.current;
    const prevSmoothed = smoothedPositionRef.current;

    // ---- Outlier / "teleport" rejection ----
    if (prevRaw) {
      const dist = distanceMeters(prevRaw, raw);
      const dtSec = Math.max((raw.timestamp - prevRaw.timestamp) / 1000, 1);
      const speed = dist / dtSec;
      const tolerance = Math.max(prevRaw.accuracy || 0, raw.accuracy || 0) / 8;
      const plausible = speed <= MAX_REALISTIC_SPEED_MPS + tolerance;

      if (!plausible) {
        if (
          pendingJumpRef.current &&
          distanceMeters(pendingJumpRef.current, raw) < JUMP_CONFIRM_DISTANCE_M
        ) {
          pendingJumpRef.current = null; // confirmed by a second reading — accept below
        } else {
          pendingJumpRef.current = raw;
          return;
        }
      } else {
        pendingJumpRef.current = null;
      }
    }

    // ---- Accuracy gating ----
    // Always accept the very first fix so the UI isn't left blank; after
    // that, a fix this imprecise just doesn't move the dot.
    if (prevSmoothed && raw.accuracy > MAX_USABLE_ACCURACY_M) {
      lastRawFixRef.current = raw;
      return;
    }

    // ---- Accuracy-weighted smoothing ----
    // Better accuracy -> trust the new fix more; worse accuracy -> lean
    // more on where we already were. Keeps the dot from jittering around
    // on GPS noise while still tracking real movement responsively.
    let smoothed;
    if (!prevSmoothed) {
      smoothed = {
        lat: raw.lat,
        lng: raw.lng,
        accuracy: raw.accuracy,
        timestamp: raw.timestamp,
      };
    } else {
      const alpha = clamp(1 - raw.accuracy / 40, 0.15, 0.85);
      smoothed = {
        lat: prevSmoothed.lat + (raw.lat - prevSmoothed.lat) * alpha,
        lng: prevSmoothed.lng + (raw.lng - prevSmoothed.lng) * alpha,
        accuracy: raw.accuracy,
        timestamp: raw.timestamp,
      };
    }

    // ---- Heading fallback (only when no compass is active) ----
    if (!compassActiveRef.current) {
      if (raw.heading !== null) {
        applySmoothedHeading(raw.heading);
      } else if (prevRaw) {
        const moved = distanceMeters(prevRaw, raw);
        if (moved > 2) applySmoothedHeading(bearing(prevRaw, raw));
      }
    }

    lastRawFixRef.current = raw;
    smoothedPositionRef.current = smoothed;
    setPosition(smoothed);
  }, [applySmoothedHeading]);

  useEffect(() => {
    if (!active) return undefined;

    // ---- Compass ----
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

    // ---- GPS ----
    const startWatching = async () => {
      try {
        const id = await Geolocation.watchPosition(
          { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
          (pos, err) => {
            if (err) {
              console.error("Geolocation watch error:", err);
              return;
            }
            if (!pos) return;
            handleRawFix({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              heading:
                typeof pos.coords.heading === "number" &&
                !Number.isNaN(pos.coords.heading)
                  ? pos.coords.heading
                  : null,
              timestamp: Date.now(),
            });
          }
        );
        watchIdRef.current = id;
      } catch (err) {
        console.error("Geolocation watch failed:", err);
      }
    };

    startWatching();

    // Staleness check + breadcrumb sampling, once a second.
    intervalRef.current = setInterval(() => {
      const ageMs = Date.now() - lastFixReceivedAtRef.current;
      if (lastFixReceivedAtRef.current && ageMs > STALE_WARNING_MS) {
        if (!staleWarnedRef.current) {
          setIsStale(true);
          staleWarnedRef.current = true;
        }
        return;
      }

      if (smoothedPositionRef.current) {
        onAcceptedRef.current?.(smoothedPositionRef.current);
      }
    }, 1000);

    return () => {
      if (watchIdRef.current !== null) {
        Geolocation.clearWatch({ id: watchIdRef.current }).catch((err) =>
          console.error(err)
        );
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
  }, [active, handleOrientation, handleRawFix]);

  return { position, heading, isStale, needsCompassPermission, enableCompass };
}
