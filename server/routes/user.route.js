import express from "express";
import {
  getUserProfile,
  loginUser,
  logoutUser,
  registerUser,
} from "../controllers/user.controller.js";
import {
  authenticate,
  sessionAuthentication,
} from "../middlewares/auth.middleware.js";
import {
  validateLogin,
  validateRegister,
} from "../middlewares/validate.middleware.js";

const userRouter = express.Router();

userRouter.get("/", sessionAuthentication, authenticate, getUserProfile);
userRouter.post("/login", validateLogin, loginUser);
userRouter.post("/register", validateRegister, registerUser);
userRouter.post("/logout", authenticate, logoutUser);

export default userRouter;
