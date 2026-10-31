import { useEffect, useRef, useState } from "react";
import { Camera, Eye, EyeOff, ShieldCheck, Trash2, Upload } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { api, mediaUrl } from "../../services/api";
import UserAvatar from "../../components/UserAvatar";
import PageHeader from "../../components/PageHeader";
import { nameFields } from "../../services/userName";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function dateLabel(value) {
  return value ? new Date(value).toLocaleString() : "Not available";
}

export default function ProfileSettings() {
  const { user, updateUser } = useAuth();
  const inputRef = useRef(null);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "" });
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setForm({ ...nameFields(user), email: user?.email || "" });
  }, [user?.firstName, user?.lastName, user?.name, user?.email]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function clearFeedback() {
    setMessage("");
    setError("");
  }

  function discardSelection() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setPreviewUrl("");
  }

  function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    clearFeedback();
    if (!file) return;
    if (!ACCEPTED_TYPES.has(file.type)) return setError("Choose a JPG, JPEG, PNG, or WEBP image.");
    if (file.size > MAX_FILE_SIZE) return setError("Profile photos must be 5 MB or smaller.");
    discardSelection();
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  async function saveProfile(event) {
    event.preventDefault();
    clearFeedback();
    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    const email = form.email.trim();
    if (!firstName || !lastName || !email) return setError("First name, last name, and email address are required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("Enter a valid email address.");
    setSaving(true);
    try {
      const data = await api.updateProfile({ firstName, lastName, email });
      updateUser(data.user);
      setMessage("Profile updated successfully.");
    } catch (saveError) {
      setError(saveError.message || "Profile could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  async function savePhoto() {
    if (!selectedFile) return;
    clearFeedback();
    setSaving(true);
    try {
      const data = await api.updateProfileImage(selectedFile);
      updateUser(data.user);
      discardSelection();
      setMessage("Profile updated successfully.");
    } catch (saveError) {
      setError(saveError.message || "Profile photo could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function removePhoto() {
    clearFeedback();
    setSaving(true);
    try {
      const data = await api.removeProfileImage();
      updateUser(data.user);
      discardSelection();
      setMessage("Profile updated successfully.");
    } catch (removeError) {
      setError(removeError.message || "Profile photo could not be removed.");
    } finally {
      setSaving(false);
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    clearFeedback();
    if (!passwords.currentPassword || !passwords.newPassword || !passwords.confirmPassword) return setError("Complete all password fields.");
    if (passwords.newPassword.length < 8) return setError("New password must be at least 8 characters.");
    if (passwords.newPassword !== passwords.confirmPassword) return setError("New password confirmation does not match.");
    setSaving(true);
    try {
      const data = await api.changePassword({ currentPassword: passwords.currentPassword, newPassword: passwords.newPassword });
      setPasswords({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setMessage(data.message || "Password changed successfully.");
    } catch (saveError) {
      setError(saveError.message || "Password could not be changed.");
    } finally {
      setSaving(false);
    }
  }

  function cancelChanges() {
    setForm({ ...nameFields(user), email: user?.email || "" });
    setPasswords({ currentPassword: "", newPassword: "", confirmPassword: "" });
    discardSelection();
    clearFeedback();
  }

  const displayedImage = previewUrl || mediaUrl(user?.profileImage);
  const passwordType = showPasswords ? "text" : "password";

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow="Settings" title="Profile Settings" description="Manage your account information, profile picture, and password." />
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">{error}</p>}
      {message && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700" role="status">{message}</p>}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <form className="premium-card p-6" onSubmit={saveProfile}>
          <div className="mb-6"><p className="text-xs font-bold uppercase tracking-[0.14em] text-[#D94F00]">Profile</p><h2 className="mt-1 text-xl font-black text-slate-950">Profile Information</h2></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="label">First Name<input className="field" name="firstName" autoComplete="given-name" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} disabled={saving} required /></label>
            <label className="label">Last Name<input className="field" name="lastName" autoComplete="family-name" value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} disabled={saving} required /></label>
            <label className="label sm:col-span-2">Email Address<input className="field" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} disabled={saving} required /></label>
            {user?.role === "student" && <label className="label">Student Number<input className="field bg-slate-50" value={user.studentNumber || "Not available"} disabled readOnly /></label>}
            <label className="label">Account Role<input className="field capitalize bg-slate-50" value={user?.role || ""} disabled readOnly /></label>
          </div>
          <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-100 pt-5"><button className="btn-primary px-5 py-2.5 text-sm" disabled={saving} type="submit">{saving ? "Saving..." : "Save Changes"}</button><button className="btn-neutral px-5 py-2.5 text-sm" disabled={saving} type="button" onClick={cancelChanges}>Cancel</button></div>
        </form>

        <section className="premium-card p-6">
          <div className="mb-6"><p className="text-xs font-bold uppercase tracking-[0.14em] text-[#D94F00]">Profile picture</p><h2 className="mt-1 text-xl font-black text-slate-950">Photo Management</h2></div>
          <div className="flex flex-col items-center text-center"><div className="relative h-28 w-28">{displayedImage ? <img className="h-28 w-28 rounded-full border-4 border-white object-cover shadow-md" src={displayedImage} alt="Profile preview" /> : <UserAvatar user={user} className="h-28 w-28" textClassName="text-2xl" alt="Default profile avatar" />}{selectedFile && <span className="absolute -right-1 bottom-1 rounded-full bg-[#FF6B00] p-2 text-white"><Camera size={15} /></span>}</div><p className="mt-4 text-sm text-slate-500">JPG, JPEG, PNG, or WEBP. Maximum 5 MB.</p><div className="mt-4 flex flex-wrap justify-center gap-2"><button className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm" disabled={saving} onClick={() => inputRef.current?.click()} type="button"><Upload size={16} />{user?.profileImage || selectedFile ? "Change Photo" : "Choose Photo"}</button>{user?.profileImage && !selectedFile && <button className="btn-neutral inline-flex items-center gap-2 px-3 py-2 text-sm" disabled={saving} onClick={removePhoto} type="button"><Trash2 size={16} />Remove</button>}</div><input ref={inputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} />{selectedFile && <div className="mt-5 flex gap-2"><button className="btn-primary px-3 py-2 text-sm" disabled={saving} onClick={savePhoto} type="button">Save Photo</button><button className="btn-neutral px-3 py-2 text-sm" disabled={saving} onClick={discardSelection} type="button">Cancel</button></div>}</div>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <form className="premium-card p-6" onSubmit={savePassword}>
          <div className="mb-6 flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[#D94F00]">Security</p><h2 className="mt-1 text-xl font-black text-slate-950">Change Password</h2></div><ShieldCheck className="text-[#FF6B00]" size={25} /></div>
          <div className="space-y-4"><label className="label">Current Password<input className="field" type={passwordType} value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} disabled={saving} autoComplete="current-password" /></label><label className="label">New Password<input className="field" type={passwordType} value={passwords.newPassword} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} disabled={saving} autoComplete="new-password" /></label><label className="label">Confirm New Password<input className="field" type={passwordType} value={passwords.confirmPassword} onChange={(event) => setPasswords({ ...passwords, confirmPassword: event.target.value })} disabled={saving} autoComplete="new-password" /></label></div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><button className="inline-flex items-center gap-2 text-sm font-bold text-[#D94F00]" onClick={() => setShowPasswords(!showPasswords)} type="button">{showPasswords ? <EyeOff size={16} /> : <Eye size={16} />}{showPasswords ? "Hide Passwords" : "Show Passwords"}</button><button className="btn-primary px-5 py-2.5 text-sm" disabled={saving} type="submit">Change Password</button></div>
        </form>

        <section className="premium-card p-6"><div className="mb-6"><p className="text-xs font-bold uppercase tracking-[0.14em] text-[#D94F00]">Account</p><h2 className="mt-1 text-xl font-black text-slate-950">Account Information</h2></div><dl className="space-y-4 text-sm"><div className="flex justify-between gap-4 border-b border-slate-100 pb-3"><dt className="text-slate-500">Full Name</dt><dd className="text-right font-semibold text-slate-900">{user?.name || "Not available"}</dd></div><div className="flex justify-between gap-4 border-b border-slate-100 pb-3"><dt className="text-slate-500">Email Address</dt><dd className="text-right font-semibold text-slate-900">{user?.email || "Not available"}</dd></div><div className="flex justify-between gap-4 border-b border-slate-100 pb-3"><dt className="text-slate-500">Account Role</dt><dd className="capitalize font-semibold text-slate-900">{user?.role || "Not available"}</dd></div><div className="flex justify-between gap-4 border-b border-slate-100 pb-3"><dt className="text-slate-500">Account Created</dt><dd className="text-right font-semibold text-slate-900">{dateLabel(user?.createdAt)}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-500">Last Profile Update</dt><dd className="text-right font-semibold text-slate-900">{dateLabel(user?.updatedAt)}</dd></div></dl></section>
      </div>
    </section>
  );
}
