import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FaArrowLeft, FaRoute, FaClock, FaMapMarkedAlt, FaCompass } from "react-icons/fa";
import TrailMap from "../components/TrailMap";
import { trailApi } from "../interceptors/Trail.api";
import { useLiveGeolocation } from "../hooks/useLiveGeolocation";

const formatDuration = (startedAt, endedAt) => {
  if (!startedAt || !endedAt) return "—";
  const ms = new Date(endedAt) - new Date(startedAt);
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const StatChip = ({ icon: Icon, label, value }) => (
  <div className="flex items-center gap-2 bg-canvas/60 rounded-xl py-2.5 px-3 flex-1 justify-center">
    <Icon className="text-accent" size={13} />
    <div className="leading-tight">
      <div className="font-display font-bold text-sm">{value}</div>
      <div className="text-[9px] uppercase tracking-wide text-ink-faint">{label}</div>
    </div>
  </div>
);

const TrailDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [trail, setTrail] = useState(null);
  const [loading, setLoading] = useState(true);

  // Show the viewer's own live position + facing direction on top of the
  // saved route, so they can retrace it in person.
  const { position: livePosition, heading, needsCompassPermission, enableCompass } =
    useLiveGeolocation({ active: true });

  useEffect(() => {
    let cancelled = false;
    const fetchTrail = async () => {
      try {
        setLoading(true);
        const res = await trailApi.get(`/${id}`);
        if (!cancelled) setTrail(res.data);
      } catch (error) {
        toast.error(typeof error === "string" ? error : "Could not load trail");
        navigate("/");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchTrail();
    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas text-ink flex items-center justify-center">
        <div className="flex items-center gap-3 text-ink-muted">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          Loading trail...
        </div>
      </div>
    );
  }

  if (!trail) return null;

  const distanceKm = (trail.distanceMeters / 1000).toFixed(2);

  return (
    <div className="h-screen w-full bg-canvas text-ink flex flex-col overflow-hidden">
      <div className="px-4 pt-4 pb-3 bg-surface border-b border-border shadow-lg shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={() => navigate("/")}
            className="text-ink-muted hover:text-ink w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-2 transition"
            aria-label="Back"
          >
            <FaArrowLeft size={16} />
          </button>
          <div className="min-w-0">
            <h1 className="font-display font-bold text-base truncate">{trail.title}</h1>
            <p className="text-xs text-ink-faint">
              {new Date(trail.startedAt).toLocaleString()}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <StatChip icon={FaRoute} label="Distance" value={`${distanceKm} km`} />
          <StatChip icon={FaClock} label="Duration" value={formatDuration(trail.startedAt, trail.endedAt)} />
          <StatChip icon={FaMapMarkedAlt} label="Points" value={trail.pointCount} />
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        <TrailMap
          points={trail.points}
          liveLocation={livePosition}
          heading={heading}
          followByDefault={false}
          navModeDefault={false}
          height="100%"
        />

        {needsCompassPermission && (
          <button
            onClick={enableCompass}
            className="absolute top-3 left-3 z-[1000] bg-surface border border-border text-ink text-sm font-medium px-3 py-2 rounded-full shadow-lg flex items-center gap-2"
          >
            <FaCompass className="text-accent" /> Enable compass
          </button>
        )}
      </div>
    </div>
  );
};

export default TrailDetail;
