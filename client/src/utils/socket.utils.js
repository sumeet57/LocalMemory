import { io } from "socket.io-client";
import { getFromLocalStorage } from "./storage.utils.js";

let socket = null;

/**
 * Returns a single shared socket connection, authenticated with the same
 * session id used for REST calls. Lazily connects on first use and is
 * reused across the live-tracking page so we don't open a new WebSocket
 * every render.
 */
export const getSocket = () => {
  if (socket && socket.connected) return socket;

  const sessionId = getFromLocalStorage("sessionId");

  if (!socket) {
    socket = io(import.meta.env.VITE_BACKEND_URL, {
      autoConnect: false,
      auth: { sessionId },
      withCredentials: true,
      transports: ["polling", "websocket"],
  reconnectionAttempts: 5,
  reconnectionDelay: 2000
    });
  } else {
    socket.auth = { sessionId };
  }

  socket.connect();
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
  }
};
