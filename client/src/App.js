import React, { useState, useEffect } from "react";
import { io } from "socket.io-client";
import Editor from "@monaco-editor/react";

const CodeEditor = () => {
  const [code, setCode] = useState("// Start coding...");
  const [language, setLanguage] = useState("javascript");
  const [roomId, setRoomId] = useState("");
  const [joined, setJoined] = useState(false);

  // Chat state
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);

  const socket = io("http://localhost:5000"); // Backend URL

  useEffect(() => {
    // Listen for code updates
    socket.on("code-update", (newCode) => {
      setCode(newCode);
    });

    // Listen for chat messages
    socket.on("chat-message", (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    return () => socket.disconnect();
  }, []);

  const handleJoinRoom = () => {
    if (roomId.trim() === "") return alert("Enter a Room ID!");
    socket.emit("join-room", roomId);
    setJoined(true);
  };

  const sendMessage = () => {
    if (message.trim() === "") return;
    socket.emit("chat-message", { roomId, message });
    setMessage("");
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {!joined && (
        <div style={{ textAlign: "center", marginTop: "50px" }}>
          <input
            placeholder="Enter Room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            style={{ padding: "10px", width: "200px" }}
          />
          <button
            onClick={handleJoinRoom}
            style={{ padding: "10px 20px", marginLeft: "10px" }}
          >
            Join Room
          </button>
        </div>
      )}

      {joined && (
        <div style={{ display: "flex", height: "90vh" }}>
          {/* Editor */}
          <div style={{ width: "70%" }}>
            <div style={{ textAlign: "center", margin: "10px 0" }}>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                style={{ padding: "5px" }}
              >
                <option value="javascript">JavaScript</option>
                <option value="python">Python</option>
                <option value="cpp">C++</option>
              </select>
            </div>
            <Editor
              height="80vh"
              language={language}
              value={code}
              theme="vs-dark"
              onChange={(value) => {
                setCode(value);
                socket.emit("code-change", { roomId, code: value });
              }}
            />
          </div>

          {/* Chat Sidebar */}
          <div
            style={{
              width: "30%",
              borderLeft: "1px solid gray",
              display: "flex",
              flexDirection: "column",
              padding: "10px",
            }}
          >
            <h3>Chat</h3>
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                marginBottom: "10px",
              }}
            >
              {messages.map((m, i) => (
                <p key={i}>
                  <strong>{m.user}</strong>: {m.text}
                </p>
              ))}
            </div>
            <div style={{ display: "flex" }}>
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type a message..."
                style={{ flex: 1, padding: "5px" }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendMessage();
                }}
              />
              <button onClick={sendMessage} style={{ marginLeft: "5px" }}>
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CodeEditor;