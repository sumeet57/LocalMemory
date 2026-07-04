import mongoose from "mongoose";

const PointSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    accuracy: { type: Number },
    timestamp: { type: Date, required: true, default: Date.now },
  },
  { _id: false }
);

const TrailSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      trim: true,
      default: function () {
        return `Trail - ${new Date().toLocaleDateString()}`;
      },
    },
    status: {
      type: String,
      enum: ["active", "completed"],
      default: "active",
      index: true,
    },
    // how the trail ended: manual stop by user, or automatic due to inactivity
    endReason: {
      type: String,
      enum: ["manual", "auto-inactivity", null],
      default: null,
    },
    points: {
      type: [PointSchema],
      default: [],
    },
    pointCount: { type: Number, default: 0 },
    distanceMeters: { type: Number, default: 0 },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
    lastPointAt: { type: Date },
  },
  { timestamps: true }
);

// Speeds up "trail history" list queries (per user, most recent first)
TrailSchema.index({ user: 1, createdAt: -1 });
// Speeds up coordinate/point lookups for a specific trail
TrailSchema.index({ user: 1, status: 1 });

const Trail = mongoose.model("Trail", TrailSchema);
export default Trail;
