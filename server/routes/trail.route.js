import express from "express";
import {
  deleteTrail,
  getTrail,
  listTrails,
  renameTrail,
} from "../controllers/trail.controller.js";
import {
  authenticate,
  sessionAuthentication,
} from "../middlewares/auth.middleware.js";

const trailRouter = express.Router();

trailRouter.use(sessionAuthentication, authenticate);

trailRouter.get("/", listTrails);
trailRouter.get("/:id", getTrail);
trailRouter.patch("/:id", renameTrail);
trailRouter.delete("/:id", deleteTrail);

export default trailRouter;
