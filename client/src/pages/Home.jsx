import React, { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  FaPlay,
  FaSignOutAlt,
  FaSignInAlt,
  FaRoute,
  FaClock,
  FaMapMarkedAlt,
  FaTrash,
  FaMountain,
  FaChevronRight,
} from "react-icons/fa";
import { UserContext } from "../context/UserContext";
import { trailApi } from "../interceptors/Trail.api";

const statusBadge = (status) =>
  status === "active"
    ? "bg-accent/15 text-accent border border-accent/30"
    : "bg-surface-2 text-ink-muted border border-border";

const TrailCard = ({ trail, onOpen, onDelete }) => {
  const distanceKm = (trail.distanceMeters / 1000).toFixed(2);
  return (
    <div
      onClick={() => onOpen(trail._id)}
      className="group bg-surface hover:bg-surface-2 transition rounded-2xl p-4 cursor-pointer border border-border flex justify-between items-center"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <h3 className="font-display font-semibold text-ink truncate">{trail.title}</h3>
          <span className={`text-[9px] shrink-0 px-2 py-0.5 rounded-full uppercase font-semibold tracking-wide ${statusBadge(trail.status)}`}>
            {trail.status}
          </span>
        </div>
        <p className="text-xs text-ink-faint mb-3">
          {new Date(trail.startedAt || trail.createdAt).toLocaleString()}
        </p>
        <div className="flex gap-4 text-xs text-ink-muted">
          <span className="flex items-center gap-1.5">
            <FaRoute className="text-accent" size={11} /> {distanceKm} km
          </span>
          <span className="flex items-center gap-1.5">
            <FaMapMarkedAlt className="text-accent" size={11} /> {trail.pointCount} pts
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(trail._id);
          }}
          className="text-ink-faint hover:text-red-500 p-2.5 rounded-full hover:bg-red-500/10 transition"
          aria-label="Delete trail"
        >
          <FaTrash size={13} />
        </button>
        <FaChevronRight className="text-ink-faint group-hover:text-accent transition hidden sm:block" size={13} />
      </div>
    </div>
  );
};

const Home = () => {
  const { user, logout, loading: userLoading } = useContext(UserContext);
  const navigate = useNavigate();

  const [trails, setTrails] = useState([]);
  const [loadingTrails, setLoadingTrails] = useState(false);

  const fetchTrails = async () => {
    try {
      setLoadingTrails(true);
      const res = await trailApi.get("/");
      setTrails(res.data || []);
    } catch (error) {
      setTrails([]);
    } finally {
      setLoadingTrails(false);
    }
  };

  useEffect(() => {
    if (user) fetchTrails();
  }, [user]);

  const handleDelete = async (trailId) => {
    const sure = window.confirm("Delete this trail permanently?");
    if (!sure) return;
    try {
      await trailApi.delete(`/${trailId}`);
      setTrails((prev) => prev.filter((t) => t._id !== trailId));
      toast.success("Trail deleted");
    } catch (error) {
      toast.error(typeof error === "string" ? error : "Could not delete trail");
    }
  };

  if (userLoading) {
    return (
      <div className="min-h-screen bg-canvas text-ink flex items-center justify-center">
        <div className="flex items-center gap-3 text-ink-muted">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          Loading...
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="w-full h-screen bg-canvas text-ink flex justify-center items-center flex-col p-6 text-center relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(700px circle at 50% 30%, rgba(250,204,21,0.08), transparent 70%)",
          }}
        />
        <div className="relative w-16 h-16 rounded-2xl bg-accent flex items-center justify-center mb-6">
          <FaMountain className="text-accent-ink" size={28} />
        </div>
        <h1 className="relative font-display text-3xl md:text-4xl font-bold max-w-lg">
          Real-Time Forest Trail Tracker
        </h1>
        <p className="relative text-ink-muted max-w-md mt-3 mb-8">
          Record, follow, and revisit your hikes with live GPS tracking built
          for the trail.
        </p>
        <button
          className="relative flex items-center gap-2 bg-accent hover:bg-accent-hover text-accent-ink px-7 py-3.5 rounded-full font-semibold transition active:scale-95 shadow-lg shadow-accent/10"
          onClick={() => navigate("/auth")}
        >
          <FaSignInAlt size={14} /> Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <div className="px-4 md:px-6 py-4 flex justify-between items-center border-b border-border sticky top-0 bg-canvas/90 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center shrink-0">
            <FaMountain className="text-accent-ink" size={16} />
          </div>
          <div>
            <h1 className="font-display text-base md:text-lg font-bold leading-tight">
              Hey, {user?.fullName?.firstName}
            </h1>
            <p className="text-xs text-ink-faint">Your trail history</p>
          </div>
        </div>
        <button
          className="flex items-center gap-2 text-ink-muted hover:text-ink border border-border hover:border-ink-faint px-3 py-2 rounded-full text-sm transition"
          onClick={async () => await logout()}
        >
          <FaSignOutAlt size={13} /> Logout
        </button>
      </div>

      <div className="p-4 md:p-6 max-w-2xl mx-auto">
        <button
          onClick={() => navigate("/trail/live")}
          className="w-full flex items-center justify-center gap-3 bg-accent hover:bg-accent-hover text-accent-ink font-bold text-lg py-4 rounded-2xl shadow-lg shadow-accent/10 mb-8 transition active:scale-[0.99]"
        >
          <FaPlay size={15} /> Start Trail
        </button>

        <h2 className="text-xs uppercase tracking-wide text-ink-faint font-semibold mb-3 px-1">
          Recent trails
        </h2>

        {loadingTrails ? (
          <p className="text-ink-muted text-center py-10 text-sm">Loading trails...</p>
        ) : trails.length === 0 ? (
          <div className="text-center py-16 text-ink-faint border border-dashed border-border rounded-2xl">
            <FaClock className="mx-auto text-3xl mb-3 opacity-60" />
            <p className="text-sm max-w-xs mx-auto">
              No trails recorded yet. Hit "Start Trail" to begin your first hike.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {trails.map((trail) => (
              <TrailCard
                key={trail._id}
                trail={trail}
                onOpen={(id) => navigate(`/trail/${id}`)}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Home;
