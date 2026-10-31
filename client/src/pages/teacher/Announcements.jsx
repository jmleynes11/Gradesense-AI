import LoadingState from "../../components/LoadingState";
import { useState } from "react";
import Panel from "../../components/Panel";
import { useAsyncData } from "../../hooks/useAsyncData";
import { api } from "../../services/api";

export default function Announcements() {
  const subjects = useAsyncData(api.subjectDashboard, []);
  const [form, setForm] = useState({ subject: "", title: "", message: "" });
  const [notice, setNotice] = useState("");

  async function submit(event) {
    event.preventDefault();
    await api.sendAnnouncement(form);
    setNotice("Announcement sent.");
    setForm({ subject: "", title: "", message: "" });
  }

  if (subjects.loading || subjects.error) return <LoadingState label="Loading subjects" error={subjects.error} />;
  return (
    <Panel title="Teacher Announcements">
      {notice && <p className="mb-3 rounded bg-green-50 p-2 text-sm text-green-700">{notice}</p>}
      <form className="grid gap-3" onSubmit={submit}>
        <select className="rounded border px-3 py-2" required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}>
          <option value="">Select subject</option>
          {(subjects.data || []).map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
        </select>
        <input className="rounded border px-3 py-2" placeholder="Announcement title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <textarea className="rounded border px-3 py-2" placeholder="Message" required rows="5" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
        <button className="rounded bg-slate-900 px-3 py-2 text-white" type="submit">Send Announcement</button>
      </form>
    </Panel>
  );
}
