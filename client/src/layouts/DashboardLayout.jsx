import { BarChart3, BookOpen, Bot, ClipboardList, Gamepad2, LayoutDashboard, LogOut, Menu, Settings, Shield, Trophy, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import NotificationCenter from "../components/NotificationCenter";
import BrandLogo from "../components/BrandLogo";
import UserAvatar from "../components/UserAvatar";
import ProfilePhotoPreview from "../components/ProfilePhotoPreview";
import { api } from "../services/api";

const nav = {
  admin: [["Dashboard", LayoutDashboard], ["Users", Users], ["Audit Logs", Shield]],
  teacher: [["Dashboard", LayoutDashboard], ["Subjects", BookOpen], ["Assessments", ClipboardList], ["AI Quiz Generator", Bot], ["Quiz Game", Gamepad2], ["Analytics", BarChart3], ["Reports", BookOpen], ["Settings", Settings]],
  student: [["Dashboard", LayoutDashboard], ["My Subjects", BookOpen], ["My Assessments", ClipboardList], ["Quiz Games", Gamepad2], ["Grades & Feedback", BookOpen], ["Leaderboard", Trophy], ["Settings", Settings]]
};

export default function DashboardLayout({ active, setActive, onNotificationNavigate, children }) {
  const { user, logout, updateUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false);
  const photoInputRef = useRef(null);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [photoSaving, setPhotoSaving] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const items = nav[user.role] || nav.student;

  useEffect(() => {
    if (!selectedPhoto) {
      setPhotoPreview("");
      return;
    }
    const url = URL.createObjectURL(selectedPhoto);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedPhoto]);

  function choosePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || photoSaving) return;
    setPhotoError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setPhotoError("Choose a JPG, JPEG, PNG, or WEBP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError("Profile photos must be 5 MB or smaller.");
      return;
    }
    setSelectedPhoto(file);
  }

  async function savePhoto() {
    if (!selectedPhoto || photoSaving) return;
    setPhotoSaving(true);
    setPhotoError("");
    try {
      const data = await api.updateProfileImage(selectedPhoto);
      updateUser(data.user);
      setSelectedPhoto(null);
    } catch (error) {
      setPhotoError(error.message || "Profile photo could not be saved.");
    } finally {
      setPhotoSaving(false);
    }
  }

  function select(label) {
    setActive(label);
    setOpen(false);
  }

  const sidebar = (
    <aside className="flex h-full flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 p-5">
        <div className="min-w-0 flex-1">
          <BrandLogo variant="compact" className="h-auto w-full max-w-[220px]" />
        </div>
        <button className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 lg:hidden" onClick={() => setOpen(false)} type="button" aria-label="Close navigation">
          <X size={18} />
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-4">
        {items.map(([label, Icon]) => {
          const selected = active === label;
          return (
            <button
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold transition ${selected ? "bg-[#FFF3E8] text-[#D94F00]" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}
              key={label}
              onClick={() => select(label)}
              type="button"
            >
              <Icon className={selected ? "text-[#FF6B00]" : "text-slate-400"} size={18} />
              {label}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-slate-100 p-4">
        <button className="mb-3 flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-left" onClick={() => select("Profile Settings")} type="button">
          <UserAvatar user={user} className="h-10 w-10" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-slate-950">{user?.name || user?.email}</p>
            <p className="text-xs capitalize text-slate-500">{user?.role}</p>
          </div>
        </button>
        <button className="btn-neutral flex w-full items-center justify-center gap-2 px-3 py-2 text-sm" onClick={logout} type="button">
          <LogOut size={16} />
          Logout
        </button>
      </div>
    </aside>
  );

  return (
    <div className="app-shell lg:flex">
      <div className="hidden lg:fixed lg:inset-y-0 lg:block lg:w-72">{sidebar}</div>
      {open && <div className="fixed inset-0 z-40 bg-slate-950/30 lg:hidden" onClick={() => setOpen(false)} />}
      <div className={`fixed inset-y-0 left-0 z-50 w-[min(86vw,288px)] transform transition lg:hidden ${open ? "translate-x-0" : "-translate-x-full"}`}>{sidebar}</div>

      <div className="min-w-0 flex-1 lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex items-center gap-3">
            <button className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 lg:hidden" onClick={() => setOpen(true)} type="button" aria-label="Open navigation">
              <Menu size={19} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="hidden text-xs font-semibold text-slate-500 sm:block">Dashboard / <span className="text-[#D94F00]">{active}</span></p>
              <h2 className="truncate text-lg font-black text-slate-950">{active}</h2>
            </div>
            <NotificationCenter key={user.id} onNavigate={onNotificationNavigate} />
            <div className={`relative ${user.role === "student" ? "block" : "hidden md:block"}`}>
              <input ref={photoInputRef} className="hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} />
              {user.role === "student" ? <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left">
                <button aria-label="Preview profile picture" title="Preview profile picture" className="shrink-0 cursor-pointer rounded-full transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B00] focus-visible:ring-offset-2" onClick={() => setPhotoPreviewOpen(true)} type="button"><UserAvatar user={user} className="h-8 w-8" textClassName="text-xs" /></button>
                <button className="hidden max-w-40 text-left md:block" onClick={() => setProfileMenuOpen((isOpen) => !isOpen)} type="button" aria-label="Open account menu" aria-expanded={profileMenuOpen} aria-haspopup="menu">
                  <p className="truncate text-sm font-bold text-slate-950">{user?.name || user?.email}</p>
                  <p className="text-xs capitalize text-slate-500">{user?.role}</p>
                </button>
              </div> : <button className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left" onClick={() => setProfileMenuOpen((isOpen) => !isOpen)} type="button" aria-expanded={profileMenuOpen} aria-haspopup="menu">
                <UserAvatar user={user} className="h-8 w-8" textClassName="text-xs" />
                <div className="max-w-40">
                  <p className="truncate text-sm font-bold text-slate-950">{user?.name || user?.email}</p>
                  <p className="text-xs capitalize text-slate-500">{user?.role}</p>
                </div>
              </button>}
              {profileMenuOpen && (
                <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white py-2 shadow-xl" role="menu">
                  <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
                    <button aria-label={user.role === "student" ? "Preview profile picture" : "Change profile photo"} title={user.role === "student" ? "Preview profile picture" : "Change profile photo"} className="shrink-0 cursor-pointer rounded-full transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B00] focus-visible:ring-offset-2 disabled:cursor-wait" disabled={photoSaving} onClick={() => user.role === "student" ? setPhotoPreviewOpen(true) : photoInputRef.current?.click()} type="button">
                      {photoPreview ? <img className="h-11 w-11 rounded-full object-cover" src={photoPreview} alt="Selected profile photo preview" /> : <UserAvatar user={user} className="h-11 w-11" />}
                    </button>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-950">{user?.name || user?.email}</p>
                      <p className="truncate text-xs text-slate-500">{user?.email}</p>
                      {user?.role === "student" && <p className="truncate text-xs text-slate-500">Student Number: {user?.studentNumber || "Not available"}</p>}
                    </div>
                  </div>
                  {selectedPhoto && <div className="flex gap-2 px-4 py-3"><button className="btn-primary px-3 py-2 text-sm" disabled={photoSaving} onClick={savePhoto} type="button">{photoSaving ? "Saving..." : "Save Photo"}</button><button className="btn-neutral px-3 py-2 text-sm" disabled={photoSaving} onClick={() => { setSelectedPhoto(null); setPhotoError(""); }} type="button">Cancel</button></div>}
                  {photoError && <p className="px-4 py-2 text-xs text-red-700" role="alert">{photoError}</p>}
                  <button className="w-full px-4 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50" type="button" onClick={() => { select("Settings"); setProfileMenuOpen(false); }}>Account Settings</button>
                  <div className="my-2 border-t border-slate-100" />
                  <button className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-red-600 hover:bg-red-50" type="button" onClick={logout}><LogOut size={16} />Sign out</button>
                </div>
              )}
              </div>
            </div>
        </header>
        <main className="p-4 md:p-6 xl:p-8">{children}</main>
      </div>
      {user.role === "student" && photoPreviewOpen && <ProfilePhotoPreview key={user.id} onClose={() => setPhotoPreviewOpen(false)} />}
    </div>
  );
}
