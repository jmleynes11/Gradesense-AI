import { io } from "socket.io-client";

const API_ROOT = (import.meta.env.VITE_API_URL || "http://localhost:5000/api").replace("/api", "");

export function connectStudentSocket(studentId, onNotification, onChanged) {
  if (!studentId) return null;
  const socket = io(API_ROOT, { auth: { token: localStorage.getItem("gradesense_token") }, forceNew: true });
  socket.on("notification:new", onNotification);
  if (onChanged) {
    socket.on("notification:changed", onChanged);
    socket.on("connect", onChanged);
  }
  return socket;
}
