import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
import { connectStudentSocket } from "../services/socket";

const categories = [["", "All notifications"], ["subjects", "My Subjects"], ["assessments", "My Assessments"], ["quiz_games", "Quiz Games"], ["grades", "Grades"], ["feedback", "Feedback"], ["announcements", "Announcements"], ["learning_recommendations", "Learning recommendations"]];

export default function NotificationCenter({ onNavigate }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("");
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [markingAll, setMarkingAll] = useState(false);
  const rootRef = useRef(null);
  const openRef = useRef(false);
  const typeRef = useRef("");
  const refreshRef = useRef(() => {});
  const aliveRef = useRef(false);
  const studentId = user?.role === "student" ? user.id : null;

  useEffect(() => {
    if (!studentId) return undefined;
    let active = true;
    let running = false;
    let queued = false;
    aliveRef.current = true;
    setItems([]);
    setUnread(0);
    setLoading(true);
    async function refresh() {
      if (!active) return;
      if (running) { queued = true; return; }
      running = true;
      do {
        queued = false;
        try {
          const data = await api.notifications();
          if (!active) break;
          setItems(data.notifications);
          setUnread(data.unreadCount);
          setError("");
          const visible = data.notifications.filter((item) => matchesCategory(item, typeRef.current));
          const ids = visible.filter((item) => !item.isRead).map((item) => item._id);
          if (openRef.current && ids.length) {
            const read = await api.markNotificationsRead(ids);
            if (!active) break;
            const readIds = new Set(ids);
            setItems((current) => current.map((item) => readIds.has(item._id) ? { ...item, isRead: true } : item));
            setUnread(read.unreadCount);
          }
        } catch (loadError) {
          if (active) setError(loadError.message || "Notifications could not be loaded.");
        } finally {
          if (active) setLoading(false);
        }
      } while (queued && active);
      running = false;
    }
    refreshRef.current = refresh;
    void refresh();
    const socket = connectStudentSocket(studentId, refresh, refresh);
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      aliveRef.current = false;
      refreshRef.current = () => {};
      socket?.disconnect();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [studentId]);

  useEffect(() => {
    if (!open) return undefined;
    function close(event) {
      if (event.type === "keydown" ? event.key === "Escape" : !rootRef.current?.contains(event.target)) {
        openRef.current = false;
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (user?.role !== "student") return null;

  async function markRead(notification) {
    try {
      if (!notification.isRead) {
        const data = await api.markNotificationRead(notification._id);
        if (!aliveRef.current) return;
        setItems((current) => current.map((item) => item._id === notification._id ? { ...item, isRead: true } : item));
        setUnread(data.unreadCount);
      }
      openRef.current = false;
      setOpen(false);
      onNavigate?.(notification);
    } catch (readError) {
      if (aliveRef.current) setError(readError.message || "Notification could not be marked as read.");
    }
  }

  async function markAllRead() {
    if (markingAll) return;
    setMarkingAll(true);
    try {
      const data = await api.markAllNotificationsRead();
      if (!aliveRef.current) return;
      setItems((current) => current.map((item) => ({ ...item, isRead: true })));
      setUnread(data.unreadCount);
      setError("");
      void refreshRef.current();
    } catch (readError) {
      if (aliveRef.current) setError(readError.message || "Notifications could not be marked as read.");
    } finally {
      if (aliveRef.current) setMarkingAll(false);
    }
  }

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button className="relative flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-700 transition hover:bg-[#FFF3E8] hover:text-[#D94F00] sm:px-3" onClick={() => { openRef.current = !open; setOpen(!open); if (!open) void refreshRef.current(); }} type="button" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open} aria-controls="student-notifications">
        <Bell size={18} />
        <span>Notifications</span>
        {unread > 0 && <span className="absolute -right-2 -top-2 rounded-full bg-[#FF6B00] px-1.5 text-xs font-bold text-white" aria-live="polite">{unread}</span>}
      </button>
      {open && (
        <div id="student-notifications" role="region" aria-label="Student notifications" className="premium-card-elevated fixed left-4 right-4 top-20 z-40 flex max-h-[calc(100dvh-6rem)] flex-col overflow-hidden sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[420px]">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 p-4">
            <div>
              <h3 className="font-bold text-slate-950">Notifications</h3>
              <p className="text-xs text-slate-500">Subjects, assessments, games, and feedback</p>
            </div>
            <button className="shrink-0 text-xs font-bold text-[#D94F00] disabled:opacity-50" disabled={markingAll || !unread} onClick={markAllRead} type="button">Mark all as read</button>
          </div>
          <div className="shrink-0 border-b p-3">
            <select aria-label="Notification category" className="field py-2 text-sm" value={type} onChange={(e) => {
              setType(e.target.value);
              typeRef.current = e.target.value;
              void refreshRef.current();
            }}>
              {categories.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}
            </select>
          </div>
          {error && <div className="px-4 py-3 text-sm text-red-700" role="alert">{error}<button className="ml-2 font-semibold text-[#D94F00]" onClick={() => refreshRef.current()} type="button">Retry</button></div>}
          <div className="min-h-0 max-h-[min(24rem,55dvh)] overflow-y-auto">
            {loading && <p className="p-6 text-center text-sm text-slate-500" role="status">Loading notifications...</p>}
            {!loading && !error && !items.some((item) => matchesCategory(item, type)) && <p className="p-6 text-center text-sm text-slate-500">You're all caught up.</p>}
            {items.filter((item) => matchesCategory(item, type)).map((item) => (
              <button className={`block w-full border-b border-slate-100 p-4 text-left text-sm ${item.isRead ? "bg-white" : "bg-[#FFF3E8]"}`} key={item._id} onClick={() => markRead(item)} type="button">
                <span className="font-bold text-slate-950">{item.title}</span>
                <span className="mt-1 block text-slate-600">{item.message}</span>
                <time className="mt-1 block text-xs text-slate-400" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function matchesCategory(item, category) {
  return !category || item.type === category || (category === "assessments" && ["seatworks", "assignments", "exams"].includes(item.type));
}
