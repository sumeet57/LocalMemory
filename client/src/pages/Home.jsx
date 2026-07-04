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
} from "react-icons/fa";
import { UserContext } from "../context/UserContext";
import { trailApi } from "../interceptors/Trail.api";

const statusBadge = (status) =>
  status === "active"
    ? "bg-green-600/20 text-green-400 border border-green-600/40"
    : "bg-zinc-700 text-zinc-300 border border-zinc-600";

const TrailCard = ({ trail, onOpen, onDelete }) => {
  const distanceKm = (trail.distanceMeters / 1000).toFixed(2);
  return (
    <div
      onClick={() => onOpen(trail._id)}
      className="bg-zinc-800 hover:bg-zinc-750 hover:bg-zinc-700/70 transition rounded-xl p-4 cursor-pointer border border-zinc-700 flex justify-between items-center"
    >
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-semibold">{trail.title}</h3>
          <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase ${statusBadge(trail.status)}`}>
            {trail.status}
          </span>
        </div>
        <p className="text-xs text-zinc-400 mb-2">
          {new Date(trail.startedAt || trail.createdAt).toLocaleString()}
        </p>
        <div className="flex gap-4 text-xs text-zinc-300">
          <span className="flex items-center gap-1">
            <FaRoute className="text-amber-500" /> {distanceKm} km
          </span>
          <span className="flex items-center gap-1">
            <FaMapMarkedAlt className="text-amber-500" /> {trail.pointCount} pts
          </span>
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(trail._id);
        }}
        className="text-zinc-500 hover:text-red-500 p-2"
        aria-label="Delete trail"
      >
        <FaTrash />
      </button>
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
      // Not logged in yet, or a transient error — fail quietly on the dashboard
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
      <div className="min-h-screen bg-zinc-900 text-white flex items-center justify-center">
        Loading...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="w-full h-screen bg-zinc-900 text-white flex justify-center items-center gap-4 flex-col p-6 text-center">
        <h1 className="text-3xl md:text-4xl font-bold">Real-Time Forest Trail Tracker</h1>
        <p className="text-zinc-400 max-w-md">
          Sign in to record and revisit your hikes with live GPS tracking.
        </p>
        <button
          className="flex items-center gap-2 bg-amber-500 px-6 py-3 uppercase rounded-lg font-semibold"
          onClick={() => navigate("/auth")}
        >
          <FaSignInAlt /> Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-900 text-white">
      <div className="p-4 md:p-6 flex justify-between items-center border-b border-zinc-800 sticky top-0 bg-zinc-900/95 backdrop-blur z-10">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">
            Welcome, {user?.fullName?.firstName}
          </h1>
          <p className="text-xs text-zinc-400">Your trail history</p>
        </div>
        <button
          className="flex items-center gap-2 bg-red-600/90 hover:bg-red-600 px-3 py-2 rounded-lg text-sm"
          onClick={async () => await logout()}
        >
          <FaSignOutAlt /> Logout
        </button>
      </div>

      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <button
          onClick={() => navigate("/trail/live")}
          className="w-full flex items-center justify-center gap-3 bg-amber-500 hover:bg-amber-400 text-zinc-900 font-bold text-lg py-4 rounded-xl shadow-lg mb-6 transition"
        >
          <FaPlay /> Start Trail
        </button>

        {loadingTrails ? (
          <p className="text-zinc-400 text-center py-8">Loading trails...</p>
        ) : trails.length === 0 ? (
          <div className="text-center py-16 text-zinc-500">
            <FaClock className="mx-auto text-4xl mb-3" />
            <p>No trails recorded yet. Hit "Start Trail" to begin your first hike.</p>
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
