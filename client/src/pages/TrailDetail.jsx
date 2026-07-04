import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FaArrowLeft, FaRoute, FaClock, FaMapMarkedAlt } from "react-icons/fa";
import TrailMap from "../components/TrailMap";
import { trailApi } from "../interceptors/Trail.api";

const formatDuration = (startedAt, endedAt) => {
  if (!startedAt || !endedAt) return "—";
  const ms = new Date(endedAt) - new Date(startedAt);
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const TrailDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [trail, setTrail] = useState(null);
  const [loading, setLoading] = useState(true);

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
      <div className="min-h-screen bg-zinc-900 text-white flex items-center justify-center">
        Loading trail...
      </div>
    );
  }

  if (!trail) return null;

  const distanceKm = (trail.distanceMeters / 1000).toFixed(2);

  return (
    <div className="h-screen w-full bg-zinc-900 text-white flex flex-col overflow-hidden">
      <div className="p-4 bg-zinc-800 shadow-md flex items-center gap-3 shrink-0">
        <button
          onClick={() => navigate("/")}
          className="text-zinc-300 hover:text-white"
          aria-label="Back"
        >
          <FaArrowLeft size={18} />
        </button>
        <div>
          <h1 className="font-semibold text-lg">{trail.title}</h1>
          <p className="text-xs text-zinc-400">
            {new Date(trail.startedAt).toLocaleString()}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 p-3 bg-zinc-800/60 text-center text-sm shrink-0">
        <div className="flex flex-col items-center gap-1">
          <FaRoute className="text-amber-500" />
          <span>{distanceKm} km</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <FaClock className="text-amber-500" />
          <span>{formatDuration(trail.startedAt, trail.endedAt)}</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <FaMapMarkedAlt className="text-amber-500" />
          <span>{trail.pointCount} points</span>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <TrailMap points={trail.points} live={false} height="100%" />
      </div>
    </div>
  );
};

export default TrailDetail;
