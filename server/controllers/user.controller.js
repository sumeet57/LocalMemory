import { comparePassword, hashPassword } from "../utils/auth/password.utils.js";
import User from "../models/user.model.js";
import {
  accessTokenOptions,
  generateToken,
  refreshTokenOptions,
} from "../utils/auth/token.utils.js";
import {
  createSessionForUser,
  login,
  register,
} from "../services/auth.service.js";
import crypto from "crypto";
import { hashSessionId } from "../utils/auth/session.utils.js";

export const registerUser = async (req, res) => {
  try {
    const { fullName, email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    const userId = await register({ fullName, email, password });
    const tokens = generateToken(userId);
    const sessionId = await createSessionForUser(userId);
    return res
      .status(201)
      .cookie("accessToken", tokens.accessToken, accessTokenOptions)
      .cookie("refreshToken", tokens.refreshToken, refreshTokenOptions)
      .json({ message: "User registered successfully", sessionId });
  } catch (error) {
    console.error("Error in registerUser:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const userId = await login({ email, password });

    const tokens = generateToken(userId);
    const sessionId = await createSessionForUser(userId);
    return res
      .status(200)
      .cookie("accessToken", tokens.accessToken, accessTokenOptions)
      .cookie("refreshToken", tokens.refreshToken, refreshTokenOptions)
      .json({ message: "Login successful", sessionId });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export const getUserProfile = async (req, res) => {
  try {
    const userId = req.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.status(200).json(user);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const logoutUser = async (req, res) => {
  try {
    res.clearCookie("accessToken", accessTokenOptions);
    res.clearCookie("refreshToken", refreshTokenOptions);
    const rawSessionId = req.headers["x-session-id"];
    if (!rawSessionId) {
      return res.status(400).json({ error: "Session ID missing" });
    }
    const hashed = hashSessionId(rawSessionId);
    await User.updateOne(
      { _id: req.userId },
      { $pull: { sessions: { sessionIdHash: hashed } } }
    );

    return res.status(200).json({ message: "Logout successful" });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
};
