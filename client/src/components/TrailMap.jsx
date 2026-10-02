import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
  Circle,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { FaLocationArrow, FaCompass } from "react-icons/fa";
import { nearestPointOnPolyline } from "../utils/geo.utils";

// ---------------------------------------------------------------------------
// Leaflet measures its container's pixel size the moment it mounts. If that
// happens while a parent flex/CSS transition hasn't settled yet (very common
// right after a route change), Leaflet freezes on a 0x0 or stale size and the
// map appears as a blank/black box even though the DOM node is there. Calling
// invalidateSize() after mount (and on resize) forces it to re-measure.
// ---------------------------------------------------------------------------
function InvalidateSizeOnMount({ watch }) {
  const map = useMap();
  useEffect(() => {
    const fix = () => map.invalidateSize();
    fix();
    const t1 = setTimeout(fix, 100);
    const t2 = setTimeout(fix, 400);
    window.addEventListener("resize", fix);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("resize", fix);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, watch]);
  return null;
}

// Default Leaflet marker images don't resolve correctly through bundlers -
// point them at the CDN instead so pins render properly.
const startIcon = new L.Icon({
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

// ---------------------------------------------------------------------------
// Google-Maps-style "you are here" marker: a blue dot with a white ring, a
// soft pulsing halo when we don't know which way the user is facing, and a
// directional "flashlight" cone when we do. In heading-up (nav) mode the
// whole map is rotated so travel direction always points to the top of the
// screen, so the cone itself is drawn pointing straight up (0deg) in that
// mode — the outer map rotation is what encodes the real-world direction.
// ---------------------------------------------------------------------------
const LOCATION_STYLE_ID = "trail-tracker-live-marker-styles";
function ensureLocationMarkerStyles() {
  if (document.getElementById(LOCATION_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = LOCATION_STYLE_ID;
  style.textContent = `
    @keyframes trailPulseAnim {
      0%   { transform: translate(-50%, -50%) scale(0.6); opacity: 0.55; }
      70%  { transform: translate(-50%, -50%) scale(2.4); opacity: 0; }
      100% { opacity: 0; }
    }
    .trail-live-pulse {
      position: absolute; top: 50%; left: 50%;
      width: 20px; height: 20px; border-radius: 50%;
      transform: translate(-50%, -50%);
      animation: trailPulseAnim 1.8s ease-out infinite;
    }
  `;
  document.head.appendChild(style);
}

// Static 64°-wide sector path pointing "up" (north). We rotate the whole
// group with a CSS transform instead of recomputing the path per heading.
const CONE_PATH = "M60,60 L34.565,19.296 A48,48 0 0,1 85.435,19.296 Z";

function buildLocationIcon(coneHeading, offTrail) {
  const hasHeading = typeof coneHeading === "number" && !Number.isNaN(coneHeading);
  const dotColor = offTrail ? "#f59e0b" : "#3b82f6"; // amber when off the recorded path

  const cone = hasHeading
    ? `<svg width="120" height="120" viewBox="0 0 120 120"
          style="position:absolute; top:-40px; left:-40px;
                 transform:rotate(${coneHeading}deg); transform-origin:60px 60px;">
         <defs>
           <radialGradient id="trailConeGrad" cx="50%" cy="100%" r="100%">
             <stop offset="0%" stop-color="${dotColor}" stop-opacity="0.6" />
             <stop offset="100%" stop-color="${dotColor}" stop-opacity="0" />
           </radialGradient>
         </defs>
         <path d="${CONE_PATH}" fill="url(#trailConeGrad)" />
       </svg>`
    : `<div class="trail-live-pulse" style="background:${dotColor}66"></div>`;

  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative; width:20px; height:20px;">
        ${cone}
        <div style="position:absolute; top:50%; left:50%; width:18px; height:18px;
                    background:${dotColor}; border:3px solid #0a0a0a; border-radius:50%;
                    transform:translate(-50%,-50%);
                    box-shadow:0 0 0 2px #f6f3ec, 0 2px 6px rgba(0,0,0,0.5);"></div>
      </div>
    `,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

/** The live "you are here" marker: dot + facing cone + GPS accuracy halo.
 *  Turns amber if the raw fix is far enough from the recorded trail that we
 *  chose not to snap it onto the line (i.e. you've actually wandered off). */
function LiveLocationMarker({ position, coneHeading, accuracy, offTrail }) {
  useEffect(() => {
    ensureLocationMarkerStyles();
  }, []);

  const roundedHeading =
    typeof coneHeading === "number" && !Number.isNaN(coneHeading)
      ? Math.round(coneHeading / 3) * 3
      : null;

  const icon = useMemo(
    () => buildLocationIcon(roundedHeading, offTrail),
    [roundedHeading, offTrail]
  );

  if (!position) return null;

  return (
    <>
      {typeof accuracy === "number" && accuracy > 0 && (
        <Circle
          center={position}
          radius={accuracy}
          pathOptions={{
            color: offTrail ? "#f59e0b" : "#3b82f6",
            weight: 1,
            fillColor: offTrail ? "#f59e0b" : "#3b82f6",
            fillOpacity: 0.1,
          }}
        />
      )}
      <Marker position={position} icon={icon} zIndexOffset={1000} />
    </>
  );
}

// Keeps the map centered on the live position while `follow` is on.
function FollowOnUpdate({ position, follow }) {
  const map = useMap();
  useEffect(() => {
    if (follow && position) {
      map.setView(position, map.getZoom(), { animate: true });
    }
  }, [position, follow, map]);
  return null;
}

// Zooms in close the moment a live position first becomes available —
// the "snap into navigation view" feel of starting turn-by-turn nav.
function AutoZoomOnStart({ position, enabled, zoomLevel = 18 }) {
  const map = useMap();
  const didZoomRef = useRef(false);
  useEffect(() => {
    if (enabled && position && !didZoomRef.current) {
      didZoomRef.current = true;
      map.setView(position, zoomLevel, { animate: true });
    }
  }, [enabled, position, map, zoomLevel]);
  return null;
}

// Turns off auto-follow the moment the person manually drags the map, so
// exploring around doesn't fight the live tracking.
function DetectManualPan({ onUserPanned }) {
  const map = useMap();
  useEffect(() => {
    map.on("dragstart", onUserPanned);
    return () => map.off("dragstart", onUserPanned);
  }, [map, onUserPanned]);
  return null;
}

// Fits the map bounds to the full breadcrumb path once (used for historical view)
function FitToPath({ points, skip }) {
  const map = useMap();
  const didFit = useRef(false);
  useEffect(() => {
    if (!skip && !didFit.current && points.length > 0) {
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [40, 40] });
      didFit.current = true;
    }
  }, [points, map, skip]);
  return null;
}

/**
 * points: [{ lat, lng }] — the recorded/historical breadcrumb trail (red line)
 * liveLocation: { lat, lng, accuracy } | null — the device's live position
 * heading: number | null — compass/GPS facing direction, in degrees
 * followByDefault: auto-follow the live position as it updates
 * navModeDefault: start in "heading-up" navigation mode (map rotates so
 *   your direction of travel always points up the screen, Google-Maps-nav
 *   style) vs. a fixed north-up map. The person can toggle this at any time.
 */
const TrailMap = ({
  points = [],
  liveLocation = null,
  heading = null,
  followByDefault = false,
  navModeDefault = false,
  height = "100%",
}) => {
  const mapRef = useRef(null);
  const [follow, setFollow] = useState(followByDefault);
  const [headingUp, setHeadingUp] = useState(navModeDefault);

  const hasPoints = points.length > 0;
  const start = hasPoints ? points[0] : null;
  const polylinePositions = points.map((p) => [p.lat, p.lng]);

  // ---- Snap-to-trail ----------------------------------------------------
  // Two different GPS sessions (recording vs. re-walking later) almost
  // never trace pixel-identical coordinates even on the same physical
  // path. Snap the displayed dot onto the nearest point of the recorded
  // route whenever it's plausibly the same spot; show the true raw
  // position (flagged amber) if you've genuinely wandered off it.
  const snapInfo = useMemo(() => {
    if (!liveLocation || points.length < 2) return null;
    return nearestPointOnPolyline(liveLocation, points);
  }, [liveLocation, points]);

  const maxSnapDistance = liveLocation
    ? Math.min(Math.max(liveLocation.accuracy || 15, 15), 50)
    : 0;
  const isOffTrail = !!(snapInfo && snapInfo.distance > maxSnapDistance);

  const displayPosition = liveLocation
    ? snapInfo && !isOffTrail
      ? [snapInfo.point.lat, snapInfo.point.lng]
      : [liveLocation.lat, liveLocation.lng]
    : null;

  const initialCenter =
    displayPosition ||
    (hasPoints
      ? [points[points.length - 1].lat, points[points.length - 1].lng]
      : [20.5937, 78.9629]); // fallback: center of India

  // In heading-up mode, the cone is drawn pointing straight up (0deg)
  // because the map rotation itself already encodes the real direction.
  const coneHeading = headingUp ? 0 : heading;
  const mapRotationDeg =
    headingUp && typeof heading === "number" ? -heading : 0;

  const handleRecenter = () => {
    setFollow(true);
    if (mapRef.current && displayPosition) {
      mapRef.current.setView(
        displayPosition,
        Math.max(mapRef.current.getZoom(), 17),
        { animate: true }
      );
    }
  };

  return (
    <div
      style={{ height, width: "100%", minHeight: "300px", position: "relative" }}
      className="rounded-lg overflow-hidden bg-surface"
    >
      {/* Rotation wrapper: scaled up so corners stay covered while rotated.
          A CSS transform on this wrapper doesn't affect Leaflet's own size
          measurements (those read layout box size, untouched by transform),
          so pan/zoom math underneath stays correct — only the paint rotates. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `rotate(${mapRotationDeg}deg) scale(${headingUp ? 1.6 : 1})`,
          transformOrigin: "center center",
          transition: "transform 0.25s linear",
        }}
      >
        <MapContainer
          ref={mapRef}
          center={initialCenter}
          zoom={hasPoints || liveLocation ? 16 : 5}
          maxZoom={20}
          scrollWheelZoom={true}
          dragging={!headingUp}
          zoomControl={false}
          attributionControl={false}
          style={{ height: "100%", width: "100%" }}
        >
          {/* Standard OSM "normal" street/terrain map layer. maxNativeZoom
              caps the actual tile requests at 19 (OSM's real max); anything
              past that just upscales the last tile so you can still zoom in
              closer on a tight trail loop without the map refusing to zoom. */}
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={20}
            maxNativeZoom={19}
          />

          {hasPoints && (
            <Polyline
              positions={polylinePositions}
              // smoothFactor={0} disables Leaflet's default line simplification,
              // which otherwise nudges the rendered line away from the exact
              // recorded coordinates.
              smoothFactor={0}
              pathOptions={{ color: "#dc2626", weight: 5, opacity: 0.9 }}
            />
          )}

          {start && <Marker position={[start.lat, start.lng]} icon={startIcon} />}

          {liveLocation && (
            <LiveLocationMarker
              position={displayPosition}
              coneHeading={coneHeading}
              accuracy={isOffTrail ? liveLocation.accuracy : null}
              offTrail={isOffTrail}
            />
          )}

          {liveLocation && (
            <>
              <FollowOnUpdate position={displayPosition} follow={follow} />
              <DetectManualPan onUserPanned={() => setFollow(false)} />
              <AutoZoomOnStart position={displayPosition} enabled={followByDefault} />
            </>
          )}

          {!followByDefault && <FitToPath points={points} skip={!!liveLocation} />}
          <InvalidateSizeOnMount watch={points.length + (liveLocation ? 1 : 0)} />
        </MapContainer>
      </div>

      {/* Attribution rendered outside the rotation wrapper so it always
          stays upright and legible regardless of map rotation. */}
      <div className="absolute bottom-1 left-1.5 z-[999] text-[9px] leading-none text-ink-faint/80 bg-canvas/50 px-1.5 py-0.5 rounded">
        © OpenStreetMap contributors
      </div>

      {liveLocation && (
        <button
          onClick={() => setHeadingUp((v) => !v)}
          aria-label={headingUp ? "Switch to north-up map" : "Switch to heading-up navigation"}
          title={headingUp ? "North-up" : "Heading-up (nav)"}
          className={`absolute top-3 right-3 z-[1000] rounded-full w-10 h-10 flex items-center justify-center shadow-lg active:scale-95 transition border ${
            headingUp
              ? "bg-accent text-accent-ink border-accent"
              : "bg-surface-2 text-ink border-border"
          }`}
        >
          <FaCompass style={{ transform: `rotate(${headingUp ? 0 : -(heading || 0)}deg)` }} />
        </button>
      )}

      {liveLocation && (
        <button
          onClick={handleRecenter}
          aria-label="Recenter on my location"
          className={`absolute bottom-5 right-4 z-[1000] rounded-full w-11 h-11 flex items-center justify-center shadow-lg active:scale-95 transition ${
            follow ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink border border-border"
          }`}
        >
          <FaLocationArrow />
        </button>
      )}

      {isOffTrail && (
        <div className="absolute top-3 left-3 z-[1000] bg-amber-500 text-black text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg">
          {Math.round(snapInfo.distance)}m off trail
        </div>
      )}
    </div>
  );
};

export default TrailMap;
