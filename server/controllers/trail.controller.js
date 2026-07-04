import mongoose from "mongoose";
import Trail from "../models/trail.model.js";

// GET /api/trail  -> trail history list for the logged-in user (no point arrays, keeps payload light)
export const listTrails = async (req, res) => {
  try {
    const trails = await Trail.find({ user: req.userId })
      .select("title status startedAt endedAt pointCount distanceMeters createdAt")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json(trails);
  } catch (error) {
    console.error("listTrails error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// GET /api/trail/:id -> full trail including breadcrumb points, for map rendering
export const getTrail = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid trail id" });
    }

    const trail = await Trail.findOne({ _id: id, user: req.userId }).lean();
    if (!trail) {
      return res.status(404).json({ error: "Trail not found" });
    }

    return res.status(200).json(trail);
  } catch (error) {
    console.error("getTrail error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// DELETE /api/trail/:id
export const deleteTrail = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid trail id" });
    }

    const trail = await Trail.findOneAndDelete({ _id: id, user: req.userId });
    if (!trail) {
      return res.status(404).json({ error: "Trail not found" });
    }

    return res.status(200).json({ message: "Trail deleted" });
  } catch (error) {
    console.error("deleteTrail error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// Rename a trail
export const renameTrail = async (req, res) => {
  try {
    const { id } = req.params;
    const { title } = req.body;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid trail id" });
    }
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }

    const trail = await Trail.findOneAndUpdate(
      { _id: id, user: req.userId },
      { $set: { title: title.trim() } },
      { new: true }
    );
    if (!trail) {
      return res.status(404).json({ error: "Trail not found" });
    }

    return res.status(200).json(trail);
  } catch (error) {
    console.error("renameTrail error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
