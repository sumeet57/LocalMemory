import React, { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

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

const liveIcon = new L.DivIcon({
  className: "",
  html: `<div style="width:16px;height:16px;border-radius:50%;background:#22c55e;border:3px solid white;box-shadow:0 0 0 3px rgba(34,197,94,0.4)"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

// Keeps the map centered on the latest point while tracking live
function RecenterOnLatest({ position, follow }) {
  const map = useMap();
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

/**
 * points: [{ lat, lng }]
 * live: boolean - if true, follows the newest point and shows a pulsing dot
 */
const TrailMap = ({ points = [], live = false, height = "100%" }) => {
  const hasPoints = points.length > 0;
  const latest = hasPoints ? points[points.length - 1] : null;
  const start = hasPoints ? points[0] : null;

  const initialCenter = latest
    ? [latest.lat, latest.lng]
    : [20.5937, 78.9629]; // fallback: center of India

  const polylinePositions = points.map((p) => [p.lat, p.lng]);

  return (
    <div style={{ height, width: "100%" }} className="rounded-lg overflow-hidden">
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
            pathOptions={{ color: "#f59e0b", weight: 5, opacity: 0.9 }}
          />
        )}

        {start && (
          <Marker position={[start.lat, start.lng]} icon={startIcon} />
        )}

        {live && latest && (
          <Marker position={[latest.lat, latest.lng]} icon={liveIcon} />
        )}

        {live && <RecenterOnLatest position={latest ? [latest.lat, latest.lng] : null} follow={live} />}
        {!live && <FitToPath points={points} />}
      </MapContainer>
    </div>
  );
};

export default TrailMap;
