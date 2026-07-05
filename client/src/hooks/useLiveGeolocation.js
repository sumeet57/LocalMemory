import { useCallback, useEffect, useRef, useState } from "react";
import { bearing, distanceMeters } from "../utils/geo.utils";

// No fresh GPS fix in this long is worth telling the user about. Desktop /
// WiFi-based positioning realistically doesn't refresh every couple of
// seconds, so anything tighter than this produces false alarms.
const STALE_WARNING_MS = 20000;

// A hiking/trail app has no business seeing walking speeds above this —
// anything faster almost certainly means the GPS chip spat out a bad fix,
// not that the person is now sprinting. Used to catch "teleport" jumps.
const MAX_REALISTIC_SPEED_MPS = 8; // ~29 km/h

// If a jump looks implausible, we don't throw it away outright (it might be
// real — e.g. actually getting in a car). We just wait for a second reading
// that agrees with it before accepting the new location as genuine.
const JUMP_CONFIRM_DISTANCE_M = 15;

/**
 * Tracks the device's live position and facing direction.
 *
 * - `position`: latest accepted { lat, lng, accuracy }, outlier-filtered.
 * - `heading`: compass heading when available (updates in real time, even
 *   while stationary and rotating in place); falls back to GPS
 *   course-of-travel heading, then to the bearing between recent fixes.
 * - `isStale`: true once we haven't heard from the GPS in a while.
 * - `needsCompassPermission` / `enableCompass()`: iOS 13+ requires an
 *   explicit user gesture before it will hand over compass data.
 *
 * `onAccepted(point)` fires once per second with each new accepted fix —
 * used by the recording page to build/send the breadcrumb trail. The saved
 * trail viewer can ignore it and just use `position`/`heading` for the
 * overlay marker.
 */
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
      // iOS Safari: already a compass bearing (0 = north, clockwise)
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

    // ---- Compass (real device facing direction, updates continuously) ----
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
    if (!("geolocation" in navigator)) return undefined;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
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
      },
      (err) => console.error("Geolocation error:", err),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );

    // Sample the latest fix once a second: outlier-filter it, update the
    // exposed position/heading, and notify the caller.
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
          // Could be a genuine fast relocation (e.g. got in a car) or a
          // one-off GPS glitch. Require a second, corroborating reading
          // before trusting it, so a lone bad fix can't draw a "teleport"
          // line across the map.
          if (
            pendingJumpRef.current &&
            distanceMeters(pendingJumpRef.current, fix) < JUMP_CONFIRM_DISTANCE_M
          ) {
            pendingJumpRef.current = null; // confirmed — accept below
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
        // No compass data yet — fall back to GPS's own course-of-travel
        // heading, or the bearing between recent fixes if moving.
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
        navigator.geolocation.clearWatch(watchIdRef.current);
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
