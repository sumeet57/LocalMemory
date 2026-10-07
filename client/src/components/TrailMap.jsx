import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Circle, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "../lib/leafletRotateSetup";
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
// Google-Maps-style "you are here" marker: a dot with a white ring, a soft
// pulsing halo when we don't know which way the user is facing, and a
// directional "flashlight" cone when we do.
//
// Important: leaflet-rotate keeps the marker pane screen-upright by design
// (so pins/labels don't tip over when the map rotates) — only the tile and
// overlay panes (the base map, the trail line) actually rotate. That means
// our cone, which we draw by hand inside the marker's own icon, has to
// manually add the map's current bearing back in to stay correct: as the
// world rotates under you, the cone must counter-rotate by the same amount
// so it keeps pointing at your true compass heading rather than drifting
// with the map.
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

function buildLocationIcon(coneScreenAngle, offTrail) {
  const hasHeading = typeof coneScreenAngle === "number" && !Number.isNaN(coneScreenAngle);
  const dotColor = offTrail ? "#f59e0b" : "#3b82f6"; // amber when off the recorded path

  const cone = hasHeading
    ? `<svg width="120" height="120" viewBox="0 0 120 120"
          style="position:absolute; top:-40px; left:-40px;
                 transform:rotate(${coneScreenAngle}deg); transform-origin:60px 60px;">
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
function LiveLocationMarker({ position, coneScreenAngle, accuracy, offTrail }) {
  useEffect(() => {
    ensureLocationMarkerStyles();
  }, []);

  const rounded =
    typeof coneScreenAngle === "number" && !Number.isNaN(coneScreenAngle)
      ? Math.round(coneScreenAngle / 3) * 3
      : null;

  const icon = useMemo(() => buildLocationIcon(rounded, offTrail), [rounded, offTrail]);

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

// Keeps bearing state in sync with the map's *actual* current rotation —
// whether it got there via our own compass-follow effect or the person's
// own two-finger rotate gesture — and tells the parent when a rotate wasn't
// something we asked for, so auto-follow can step aside for manual input.
function BearingSync({ onBearingChange, onManualRotate, programmaticRef }) {
  const map = useMap();
  useEffect(() => {
    const handler = () => {
      onBearingChange(map.getBearing());
      if (!programmaticRef.current) onManualRotate();
    };
    map.on("rotate", handler);
    onBearingChange(map.getBearing());
    return () => map.off("rotate", handler);
  }, [map, onBearingChange, onManualRotate, programmaticRef]);
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
 * navModeDefault: start in "heading-up" navigation mode (the map itself
 *   rotates so your direction of travel always points up the screen,
 *   Google-Maps-nav style). The person can always two-finger-rotate the
 *   map manually too — that's a real gesture now, not faked — and can tap
 *   the compass button to snap back to north-up, or recenter to resume
 *   following.
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
  const programmaticRotateRef = useRef(false);

  const [follow, setFollow] = useState(followByDefault);
  const [headingUp, setHeadingUp] = useState(navModeDefault);
  const [mapBearing, setMapBearing] = useState(0);

  const hasPoints = points.length > 0;
  const start = hasPoints ? points[0] : null;
  const polylinePositions = points.map((p) => [p.lat, p.lng]);

  // ---- Snap-to-trail ------------------------------------------------
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

  // The marker pane doesn't rotate along with the base map (by design, so
  // pins stay upright) — so to make the cone represent your true compass
  // heading correctly regardless of how the map is currently rotated, we
  // have to manually add the map's live bearing back in.
  const coneScreenAngle =
    typeof heading === "number" ? (heading + mapBearing + 360) % 360 : null;

  // Push our compass-follow bearing onto the map whenever it's engaged.
  // Tagged as "programmatic" so BearingSync doesn't mistake this for a
  // manual gesture and immediately cancel follow mode.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (headingUp && typeof heading === "number") {
      programmaticRotateRef.current = true;
      map.setBearing(((-heading % 360) + 360) % 360);
      requestAnimationFrame(() => {
        programmaticRotateRef.current = false;
      });
    }
  }, [headingUp, heading]);

  const handleRecenter = () => {
    setFollow(true);
    setHeadingUp(true);
    if (mapRef.current && displayPosition) {
      mapRef.current.setView(
        displayPosition,
        Math.max(mapRef.current.getZoom(), 17),
        { animate: true }
      );
    }
  };

  const handleResetNorth = () => {
    setHeadingUp(false);
    if (mapRef.current) {
      programmaticRotateRef.current = true;
      mapRef.current.setBearing(0);
      requestAnimationFrame(() => {
        programmaticRotateRef.current = false;
      });
    }
  };

  return (
    <div
      style={{ height, width: "100%", minHeight: "300px", position: "relative" }}
      className="rounded-lg overflow-hidden bg-surface"
    >
      <MapContainer
        ref={mapRef}
        center={initialCenter}
        zoom={hasPoints || liveLocation ? 16 : 5}
        maxZoom={20}
        scrollWheelZoom={true}
        // Real map rotation (leaflet-rotate): correct drag math and a
        // genuine two-finger touch-rotate gesture, not a CSS-transform hack.
        rotate={true}
        touchRotate={true}
        bearing={0}
        rotateControl={false}
        zoomControl={false}
        style={{ height: "100%", width: "100%" }}
      >
        {/* Standard OSM "normal" street/terrain map layer. maxNativeZoom
            caps the actual tile requests at 19 (OSM's real max); anything
            past that just upscales the last tile so you can still zoom in
            closer on a tight trail loop without the map refusing to zoom. */}
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
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
            coneScreenAngle={coneScreenAngle}
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

        <BearingSync
          onBearingChange={setMapBearing}
          onManualRotate={() => setHeadingUp(false)}
          programmaticRef={programmaticRotateRef}
        />

        {!followByDefault && <FitToPath points={points} skip={!!liveLocation} />}
        <InvalidateSizeOnMount watch={points.length + (liveLocation ? 1 : 0)} />
      </MapContainer>

      {/* Leaflet's attribution control is turned off above (keeps the UI
          clean) — OSM still requires credit, shown here as plain HTML.
          Since this sits outside the map's own rotate pane, it always
          stays upright regardless of map bearing. */}
      <div className="absolute bottom-1 left-1.5 z-[999] text-[9px] leading-none text-ink-faint/80 bg-canvas/50 px-1.5 py-0.5 rounded pointer-events-none">
        © OpenStreetMap contributors
      </div>

      {liveLocation && (
        <button
          onClick={handleResetNorth}
          aria-label="Reset map to north-up"
          title="North-up"
          className="absolute top-3 right-3 z-[1000] rounded-full w-10 h-10 flex items-center justify-center shadow-lg active:scale-95 transition bg-surface-2 border border-border text-ink"
        >
          <FaCompass style={{ transform: `rotate(${-mapBearing}deg)` }} />
        </button>
      )}

      {liveLocation && (
        <button
          onClick={handleRecenter}
          aria-label="Recenter and resume navigation"
          className={`absolute bottom-5 right-4 z-[1000] rounded-full w-11 h-11 flex items-center justify-center shadow-lg active:scale-95 transition ${
            follow && headingUp
              ? "bg-accent text-accent-ink"
              : "bg-surface-2 text-ink border border-border"
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
