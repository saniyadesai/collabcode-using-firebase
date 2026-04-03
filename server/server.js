const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

io.on("connection", (socket) => {
  console.log("User connected");

  // Join a room
  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    console.log(`User joined room: ${roomId}`);
  });

  // Code change event
  socket.on("code-change", (data) => {
    socket.to(data.roomId).emit("code-update", data.code);
  });

  // Chat message event
  socket.on("chat-message", ({ roomId, message }) => {
    io.to(roomId).emit("chat-message", { user: "User", text: message });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

server.listen(5000, () => {
  console.log("Server running on port 5000");
});