import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
import UserAvatar from "./UserAvatar";

export default function ProfilePhotoPreview({ onClose }) {
  const { user, updateUser } = useAuth();
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const uploadInFlight = useRef(false);
  const mountedRef = useRef(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    mountedRef.current = true;
    dialog.showModal();
    return () => {
      mountedRef.current = false;
      dialog.close();
    };
  }, []);

  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function chooseFile(event) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected || uploadInFlight.current) return;
    setError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(selected.type)) {
      setError("Choose a JPG, JPEG, PNG, or WEBP image.");
      return;
    }
    if (selected.size > 5 * 1024 * 1024) {
      setError("Profile photos must be 5 MB or smaller.");
      return;
    }
    setFile(selected);
  }

  async function savePhoto() {
    if (!file || uploadInFlight.current) return;
    uploadInFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const data = await api.updateProfileImage(file);
      if (!mountedRef.current) return;
      updateUser(data.user);
      onClose();
    } catch (saveError) {
      if (mountedRef.current) setError(saveError.message || "Profile photo could not be saved.");
    } finally {
      uploadInFlight.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }

  return (
    <dialog ref={dialogRef} aria-labelledby="profile-photo-title" aria-modal="true" className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-sm overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 text-slate-950 shadow-xl backdrop:bg-slate-950/40" onCancel={(event) => { event.preventDefault(); if (!uploadInFlight.current) onClose(); }}>
      <h2 className="text-lg font-black" id="profile-photo-title">Profile Picture</h2>
      <div className="mt-5 flex flex-col items-center text-center">
        {preview ? <img className="h-40 w-40 rounded-full object-cover" src={preview} alt="Selected profile picture preview" /> : <UserAvatar user={user} className="h-40 w-40" textClassName="text-4xl" alt="Current profile picture" />}
        <p className="mt-4 text-sm font-bold">{user?.name || user?.email}</p>
        <p className="mt-2 text-xs text-slate-500">JPG, JPEG, PNG, or WEBP. Maximum 5 MB.</p>
        <button autoFocus className="btn-secondary mt-4 px-4 py-2 text-sm" disabled={saving} onClick={() => inputRef.current?.click()} type="button">Change Profile Picture</button>
        <input ref={inputRef} className="hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} />
      </div>
      {error && <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}
      <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4">
        <button className="btn-primary px-4 py-2 text-sm" disabled={!file || saving} onClick={savePhoto} type="button">{saving ? "Saving..." : "Save Changes"}</button>
        <button className="btn-neutral px-4 py-2 text-sm" disabled={saving} onClick={onClose} type="button">Cancel</button>
      </div>
    </dialog>
  );
}
