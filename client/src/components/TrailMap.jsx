import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
  Circle,
  useMap,
  useMapEvents,
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
// directional "flashlight" cone when we do (either from GPS heading or from
// the bearing between the last two fixes).
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

/**
 * The live "you are here" marker: blue dot + facing cone + GPS accuracy
 * halo, matching the familiar Google Maps look.
 */
function LiveLocationMarker({ position, heading, accuracy }) {
  useEffect(() => {
    ensureLocationMarkerStyles();
  }, []);

  // Round heading so we don't rebuild the icon on every 0.1° jitter
  const roundedHeading =
    typeof heading === "number" && !Number.isNaN(heading)
      ? Math.round(heading / 3) * 3
      : null;

  const icon = useMemo(
    () => buildLocationIcon(roundedHeading),
    [roundedHeading]
  );

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

// Keeps the map centered on the latest point while tracking live — unless
// the person has manually panned the map, in which case we back off and
// let them look around (a "Recenter" button brings them back to follow mode).
function FollowController({ position, follow, onUserPanned }) {
  const map = useMap();

  useMapEvents({
    dragstart() {
      onUserPanned();
    },
  });

  useEffect(() => {
    if (follow && position) {
      map.setView(position, map.getZoom(), { animate: true });
    }
  }, [position, follow, map]);

  return null;
}

// Fits the map bounds to the full breadcrumb path (used for historical view)
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

// Floating "recenter on me" button, shown once the user pans away from
// follow mode during live tracking.
function RecenterButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label="Recenter on my location"
      className="absolute bottom-5 right-4 z-[1000] bg-white text-blue-600 rounded-full w-11 h-11 flex items-center justify-center shadow-lg active:scale-95 transition"
      style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.35)" }}
    >
      <FaLocationArrow />
    </button>
  );
}

/**
 * points: [{ lat, lng, accuracy?, heading? }]
 * live: boolean - if true, shows the Google-Maps-style live location marker
 *       and follows it (until the user pans away)
 */
const TrailMap = ({ points = [], live = false, heading = null, height = "100%" }) => {
  const hasPoints = points.length > 0;
  const latest = hasPoints ? points[points.length - 1] : null;
  const start = hasPoints ? points[0] : null;

  const [follow, setFollow] = useState(true);

  const initialCenter = latest
    ? [latest.lat, latest.lng]
    : [20.5937, 78.9629]; // fallback: center of India

  const polylinePositions = points.map((p) => [p.lat, p.lng]);
  const latestPosition = latest ? [latest.lat, latest.lng] : null;

  return (
    <div
      style={{ height, width: "100%", minHeight: "300px", position: "relative" }}
      className="rounded-lg overflow-hidden"
    >
      <MapContainer
        center={initialCenter}
        zoom={hasPoints ? 16 : 5}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
      >
        {/* Standard OSM "normal" street/terrain map layer */}
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {hasPoints && (
          <Polyline
            positions={polylinePositions}
            pathOptions={{ color: "#dc2626", weight: 5, opacity: 0.9 }}
          />
        )}

        {start && (
          <Marker position={[start.lat, start.lng]} icon={startIcon} />
        )}

        {live && latest && (
          <LiveLocationMarker
            position={latestPosition}
            heading={heading}
            accuracy={latest.accuracy}
          />
        )}

        {live && (
          <FollowController
            position={latestPosition}
            follow={follow}
            onUserPanned={() => setFollow(false)}
          />
        )}
        {!live && <FitToPath points={points} />}
        <InvalidateSizeOnMount watch={points.length} />
      </MapContainer>

      {live && !follow && (
        <RecenterButton onClick={() => setFollow(true)} />
      )}
    </div>
  );
};

export default TrailMap;
