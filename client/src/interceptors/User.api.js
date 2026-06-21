import axios from "axios";
import { getFromLocalStorage } from "../utils/storage.utils.js";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL + "/api/user";

export const userApi = axios.create({
  baseURL: BACKEND_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

userApi.interceptors.request.use(
  (config) => {
    const sessionId = getFromLocalStorage("sessionId");
    if (sessionId) {
      config.headers["x-session-id"] = sessionId;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

userApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      if (window.location.pathname !== "/auth") {
        window.location.href = "/auth";
      }
    }
    return Promise.reject(error?.response?.data?.error || "An error occurred");
  }
);
