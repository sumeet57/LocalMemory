import dotenv from "dotenv";
dotenv.config();
import http from "http";
import app from "./app.js";
import { connectDB } from "./config/Database.js";
import { initSocket } from "./sockets/trail.socket.js";

const PORT = process.env.PORT || 5000;

connectDB();

// Wrap the express app in a plain http server so Socket.io can share the
// same port (needed for both the REST API and the live GPS stream).
const server = http.createServer(app);

initSocket(server, process.env.CLIENT_URL);

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
