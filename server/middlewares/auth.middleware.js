import {
  accessTokenOptions,
  generateToken,
  verifyToken,
} from "../utils/auth/token.utils.js";

export const authenticate = (req, res, next) => {
  try {
    const accessToken = req.cookies?.accessToken;
    const refreshToken = req.cookies?.refreshToken;

    if (!accessToken && !refreshToken) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    if (accessToken) {
      const accessPayload = verifyToken(accessToken);
      if (accessPayload) {
        req.userId = accessPayload.id;
        return next();
      }
    }

    if (!refreshToken) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const refreshPayload = verifyToken(refreshToken);
    if (!refreshPayload) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    const tokens = generateToken(refreshPayload.id);
    res.cookie("accessToken", tokens.accessToken, accessTokenOptions);
    req.userId = refreshPayload.id;

    return next();
  } catch (error) {
    console.error("Authenticate middleware error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

import { hashSessionId } from "../utils/auth/session.utils.js";
import User from "../models/user.model.js";

export const sessionAuthentication = async (req, res, next) => {
  try {
    const rawSessionId = req.headers["x-session-id"];
    if (!rawSessionId)
      return res.status(401).json({ error: "Session missing" });

    const hashed = hashSessionId(rawSessionId);
    const user = await User.findOneAndUpdate({
      sessions: {
        $elemMatch: { sessionIdHash: hashed },
      },
    }).lean();
    if (!user) return res.status(401).json({ error: "Invalid session" });

    req.userId = user._id;
    req.authUser = user;

    next();
  } catch (err) {
    console.error("Session middleware error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
