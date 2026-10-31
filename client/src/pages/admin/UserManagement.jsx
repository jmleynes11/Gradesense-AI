import LoadingState from "../../components/LoadingState";
import { useState } from "react";
import Panel from "../../components/Panel";
import SimpleTable from "../../components/SimpleTable";
import { api } from "../../services/api";
import { useAsyncData } from "../../hooks/useAsyncData";
import { nameFields } from "../../services/userName";

const emptyForm = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  role: "student",
  studentNumber: "",
  isActive: true
};

function sortByName(users = []) {
  return [...users].sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" }));
}

export default function UserManagement() {
  const { data, setData, loading, error: loadError } = useAsyncData(api.users, []);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function toggle(user) {
    const updated = await api.updateUser(user._id, { isActive: !user.isActive });
    setData(sortByName(data.map((item) => item._id === user._id ? updated : item)));
  }

  function edit(user) {
    setEditingId(user._id);
    setForm({
      ...nameFields(user),
      email: user.email || "",
      password: "",
      role: user.role || "student",
      subject: user.subject || "",
      studentNumber: user.studentNumber || "",
      isActive: user.isActive
    });
    setMessage("");
    setError("");
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function submit(event) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError("First name and last name are required.");
      return;
    }

    if (form.role === "student" && !form.studentNumber.trim()) {
      setError("Student Number is required for student accounts.");
      return;
    }

    try {
      const payload = { ...form, firstName: form.firstName.trim(), lastName: form.lastName.trim() };
      if (editingId && !payload.password) delete payload.password;

      if (editingId) {
        const updated = await api.updateUser(editingId, payload);
        setData((data || []).map((item) => item._id === editingId ? updated : item).sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" })));
        setMessage("User updated.");
      } else {
        const created = await api.createUser(payload);
        setData(sortByName([created, ...(data || [])]));
        setMessage("User added.");
      }

      resetForm();
    } catch (err) {
      setError(err.message);
    }
  }

  const teacherUsers = sortByName((data || []).filter((user) => user.role === "teacher"));
  const studentUsers = sortByName((data || []).filter((user) => user.role === "student"));
  const adminUsers = sortByName((data || []).filter((user) => user.role === "admin"));
  const actionColumn = {
    key: "actions",
    label: "Action",
    render: (row) => (
      <div className="flex gap-2">
        <button className="rounded border px-2 py-1 text-xs" onClick={() => edit(row)} type="button">Edit</button>
        <button className="rounded border px-2 py-1 text-xs" onClick={() => toggle(row)} type="button">{row.isActive ? "Disable" : "Enable"}</button>
      </div>
    )
  };
  const teacherColumns = [
    { key: "name", label: "Name" },
    { key: "email", label: "Email / Username" },
    { key: "subject", label: "Subject" },
    { key: "isActive", label: "Account Status", render: (row) => row.isActive ? "Active" : "Disabled" },
    actionColumn
  ];
  const studentColumns = [
    { key: "studentNumber", label: "Student Number", render: (row) => row.studentNumber || "Not set" },
    { key: "name", label: "Name" },
    { key: "email", label: "Email / Username" },
    { key: "isActive", label: "Account Status", render: (row) => row.isActive ? "Active" : "Disabled" },
    actionColumn
  ];

  if (loading || loadError) return <LoadingState label="Loading records" error={loadError} />;
  return (
    <Panel title="User Management">
      <form className="mb-4 grid gap-3 rounded border border-slate-200 bg-slate-50 p-4 md:grid-cols-3" onSubmit={submit}>
        <div className="md:col-span-3">
          <h3 className="text-sm font-semibold">{editingId ? "Edit User" : "Add User"}</h3>
          {message && <p className="mt-2 rounded bg-green-50 p-2 text-sm text-green-700">{message}</p>}
          {error && <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <input className="rounded border px-3 py-2 min-w-0" aria-label="First Name" placeholder="First Name" name="firstName" autoComplete="given-name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
          <input className="rounded border px-3 py-2 min-w-0" aria-label="Last Name" placeholder="Last Name" name="lastName" autoComplete="family-name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
        </div>
        <input className="rounded border px-3 py-2" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input className="rounded border px-3 py-2" placeholder={editingId ? "New password (optional)" : "Password"} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!editingId} />
        <select className="rounded border px-3 py-2" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value, studentNumber: e.target.value === "student" ? form.studentNumber : "" })}>
          <option value="admin">Admin</option>
          <option value="teacher">Teacher</option>
          <option value="student">Student</option>
        </select>
        {editingId && <input className="rounded border px-3 py-2" placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />}
        {form.role === "student" && <input className="rounded border px-3 py-2" placeholder="Student Number" value={form.studentNumber} onChange={(e) => setForm({ ...form, studentNumber: e.target.value })} required />}
        <label className="flex items-center gap-2 text-sm">
          <input checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} type="checkbox" />
          Active account
        </label>
        <div className="flex gap-2 md:col-span-2">
          <button className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white" type="submit">{editingId ? "Save Changes" : "Add User"}</button>
          {editingId && <button className="rounded border px-3 py-2 text-sm" onClick={resetForm} type="button">Cancel Edit</button>}
        </div>
      </form>
      <div className="space-y-6">
        <section>
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Teacher Users</h3>
          <SimpleTable columns={teacherColumns} rows={teacherUsers} />
        </section>
        <section>
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Student Users</h3>
          <SimpleTable columns={studentColumns} rows={studentUsers} />
        </section>
        {adminUsers.length > 0 && (
          <section>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Administrator Users</h3>
            <SimpleTable columns={teacherColumns} rows={adminUsers} />
          </section>
        )}
      </div>
    </Panel>
  );
}
