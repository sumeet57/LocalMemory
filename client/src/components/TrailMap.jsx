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
import { FaLocationArrow } from "react-icons/fa";

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
// directional "flashlight" cone when we do (compass heading, or GPS-course
// heading / bearing-between-fixes as a fallback).
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
      background: rgba(66, 133, 244, 0.55);
      transform: translate(-50%, -50%);
      animation: trailPulseAnim 1.8s ease-out infinite;
    }
  `;
  document.head.appendChild(style);
}

// Static 64°-wide sector path pointing "up" (north). We rotate the whole
// group with a CSS transform instead of recomputing the path per heading.
const CONE_PATH = "M60,60 L34.565,19.296 A48,48 0 0,1 85.435,19.296 Z";

function buildLocationIcon(heading) {
  const hasHeading = typeof heading === "number" && !Number.isNaN(heading);

  const cone = hasHeading
    ? `<svg width="120" height="120" viewBox="0 0 120 120"
          style="position:absolute; top:-40px; left:-40px;
                 transform:rotate(${heading}deg); transform-origin:60px 60px;">
         <defs>
           <radialGradient id="trailConeGrad" cx="50%" cy="100%" r="100%">
             <stop offset="0%" stop-color="#4285F4" stop-opacity="0.55" />
             <stop offset="100%" stop-color="#4285F4" stop-opacity="0" />
           </radialGradient>
         </defs>
         <path d="${CONE_PATH}" fill="url(#trailConeGrad)" />
       </svg>`
    : `<div class="trail-live-pulse"></div>`;

  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative; width:20px; height:20px;">
        ${cone}
        <div style="position:absolute; top:50%; left:50%; width:18px; height:18px;
                    background:#4285F4; border:3px solid #ffffff; border-radius:50%;
                    transform:translate(-50%,-50%);
                    box-shadow:0 1px 5px rgba(0,0,0,0.45);"></div>
      </div>
    `,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

/** The live "you are here" marker: blue dot + facing cone + GPS accuracy halo. */
function LiveLocationMarker({ position, heading, accuracy }) {
  useEffect(() => {
    ensureLocationMarkerStyles();
  }, []);

  // Round heading so we don't rebuild the icon on every fractional-degree jitter
  const roundedHeading =
    typeof heading === "number" && !Number.isNaN(heading)
      ? Math.round(heading / 3) * 3
      : null;

  const icon = useMemo(() => buildLocationIcon(roundedHeading), [roundedHeading]);

  if (!position) return null;

  return (
    <>
      {typeof accuracy === "number" && accuracy > 0 && (
        <Circle
          center={position}
          radius={accuracy}
          pathOptions={{
            color: "#4285F4",
            weight: 1,
            fillColor: "#4285F4",
            fillOpacity: 0.12,
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
function FitToPath({ points }) {
  const map = useMap();
  const didFit = useRef(false);
  useEffect(() => {
    if (!didFit.current && points.length > 0) {
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [40, 40] });
      didFit.current = true;
    }
  }, [points, map]);
  return null;
}

/**
 * points: [{ lat, lng }] — the recorded/historical breadcrumb trail (red line)
 * liveLocation: { lat, lng, accuracy } | null — the device's live position,
 *   shown as a Google-Maps-style blue dot, independent of the breadcrumb
 * heading: number | null — which way the device is facing (see TrailMap consumers)
 * followByDefault: whether the map should auto-follow the live location as
 *   soon as it's available (true while actively recording), vs. showing the
 *   full route first and letting the person tap "recenter" (saved trail view)
 */
const TrailMap = ({
  points = [],
  liveLocation = null,
  heading = null,
  followByDefault = false,
  height = "100%",
}) => {
  const mapRef = useRef(null);
  const [follow, setFollow] = useState(followByDefault);

  const hasPoints = points.length > 0;
  const start = hasPoints ? points[0] : null;
  const polylinePositions = points.map((p) => [p.lat, p.lng]);
  const liveLatLng = liveLocation ? [liveLocation.lat, liveLocation.lng] : null;

  const initialCenter =
    liveLatLng ||
    (hasPoints
      ? [points[points.length - 1].lat, points[points.length - 1].lng]
      : [20.5937, 78.9629]); // fallback: center of India

  const handleRecenter = () => {
    setFollow(true);
    if (mapRef.current && liveLatLng) {
      mapRef.current.setView(liveLatLng, Math.max(mapRef.current.getZoom(), 17), {
        animate: true,
      });
    }
  };

  return (
    <div
      style={{ height, width: "100%", minHeight: "300px", position: "relative" }}
      className="rounded-lg overflow-hidden"
    >
      <MapContainer
        ref={mapRef}
        center={initialCenter}
        zoom={hasPoints || liveLocation ? 16 : 5}
        maxZoom={20}
        scrollWheelZoom={true}
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
            pathOptions={{ color: "#dc2626", weight: 5, opacity: 0.9 }}
          />
        )}

        {start && <Marker position={[start.lat, start.lng]} icon={startIcon} />}

        {liveLocation && (
          <LiveLocationMarker
            position={liveLatLng}
            heading={heading}
            accuracy={liveLocation.accuracy}
          />
        )}

        {liveLocation && (
          <>
            <FollowOnUpdate position={liveLatLng} follow={follow} />
            <DetectManualPan onUserPanned={() => setFollow(false)} />
          </>
        )}

        {!followByDefault && <FitToPath points={points} />}
        <InvalidateSizeOnMount watch={points.length + (liveLocation ? 1 : 0)} />
      </MapContainer>

      {liveLocation && (
        <button
          onClick={handleRecenter}
          aria-label="Recenter on my location"
          className={`absolute bottom-5 right-4 z-[1000] rounded-full w-11 h-11 flex items-center justify-center shadow-lg active:scale-95 transition ${
            follow ? "bg-blue-600 text-white" : "bg-white text-blue-600"
          }`}
          style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.35)" }}
        >
          <FaLocationArrow />
        </button>
      )}
    </div>
  );
};

export default TrailMap;
