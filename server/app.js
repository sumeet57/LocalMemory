import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import userRouter from "./routes/user.route.js";
import limiter from "./middlewares/ratelimiter.middleware.js";
import helmet from "helmet";
import hpp from "hpp";

const app = express();

app.use(helmet());
app.use(hpp());
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "x-session-id"],
  })
);

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", limiter);

app.use("/api/user", userRouter);

app.get("/health", (req, res) => {
  res.status(200).json({ status: "success", message: "Server is healthy" });
});

app.all("{/*path}", (req, res, next) => {
  const err = new Error(`Can't find ${req.originalUrl} on this server!`);
  err.statusCode = 404;
  next(err);
});

app.use((err, req, res, next) => {
  err.statusCode = err.statusCode || 500;

  const response = {
    status: "error",
    message: err.message || "Internal server error",
  };

  if (process.env.NODE_ENV === "development") {
    response.stack = err.stack;
    response.error = err;
  }

  if (err.name === "ValidationError") {
    err.statusCode = 400;
    response.message = Object.values(err.errors)
      .map((el) => el.message)
      .join(", ");
  }

  if (err.code === 11000) {
    err.statusCode = 400;
    response.message = "Duplicate field value entered";
  }

  console.error("Error:", err);
  res.status(err.statusCode).json(response);
});

export default app;
