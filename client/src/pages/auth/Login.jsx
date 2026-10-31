import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { Bot, Eye, EyeOff, GraduationCap, ShieldCheck } from "lucide-react";
import BrandLogo from "../../components/BrandLogo";
import { AGREEMENT_REQUIRED_MESSAGE, signupValidationError } from "../../services/signupValidation";

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState(() => window.location.hash === "#signup" ? "register" : "login");
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "teacher@gradesense.test", password: "password123", confirmPassword: "", role: "teacher", studentNumber: "", agreementAccepted: false });
  const [error, setError] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (mode === "register") {
      const validationError = signupValidationError(form);
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    try {
      if (mode === "login") await login({ email: form.email, password: form.password });
      else await register({ ...form, firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim().toLowerCase() });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="grid min-h-screen bg-[#F8F9FB] p-4 lg:grid-cols-[1fr_480px]">
      <section className="hidden min-h-[calc(100vh-2rem)] flex-col justify-between rounded-lg border border-slate-200 bg-white p-10 lg:flex">
        <BrandLogo variant="compact" className="h-auto w-full max-w-[330px]" />
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#D94F00]">AI-powered academic assessment platform</p>
          <h2 className="mt-4 text-5xl font-black tracking-tight text-slate-950">Assess faster. Feedback smarter. Improve learning outcomes.</h2>
          <p className="mt-5 text-lg leading-8 text-slate-600">A modern grading and feedback workspace for teachers, students, and academic administrators.</p>
          <div className="mt-8 grid gap-3 md:grid-cols-3">
            {[[Bot, "AI quiz generation"], [GraduationCap, "Student progress"], [ShieldCheck, "Teacher authority"]].map(([Icon, text]) => (
              <div className="rounded-lg border border-slate-200 p-4" key={text}>
                <Icon className="text-[#FF6B00]" size={22} />
                <p className="mt-3 text-sm font-bold text-slate-800">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="grid min-h-[calc(100vh-2rem)] place-items-center">
        <form className="premium-card-elevated w-full max-w-md p-7" onSubmit={submit}>
        <div className="mb-6">
          <BrandLogo variant="compact" className="mb-4 h-auto w-full max-w-[260px] lg:hidden" />
          <h1 className="text-2xl font-black text-slate-950">Welcome to GradeSense <span className="text-[#FF6B00]">AI</span></h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to your assessment workspace.</p>
        </div>
        {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {mode === "register" && (
          <>
            <label className="label mt-4">First Name<input className="field" name="firstName" autoComplete="given-name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required /></label>
            <label className="label mt-4">Last Name<input className="field" name="lastName" autoComplete="family-name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required /></label>
          </>
        )}
        <label className="label mt-4">Email<input className="field" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required={mode === "register"} /></label>
        <label className="label mt-4">Password
          <span className="relative block">
            <input className="field pr-10" type={passwordVisible ? "text" : "password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={mode === "register"} minLength={mode === "register" ? 8 : undefined} />
            <button aria-label={passwordVisible ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800" onClick={() => setPasswordVisible((visible) => !visible)} type="button">
              {passwordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
        </label>
        {mode === "register" && (
          <label className="label mt-4">Confirm Password
            <span className="relative block">
              <input className="field pr-10" name="confirmPassword" autoComplete="new-password" type={confirmPasswordVisible ? "text" : "password"} value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} required />
              <button aria-label={confirmPasswordVisible ? "Hide confirm password" : "Show confirm password"} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800" onClick={() => setConfirmPasswordVisible((visible) => !visible)} type="button">
                {confirmPasswordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>
        )}
        {mode === "register" && (
          <label className="label mt-4">Role<select className="field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} required>
            <option value="teacher">Teacher</option>
            <option value="student">Student</option>
          </select></label>
        )}
        {mode === "register" && form.role === "student" && (
          <label className="label mt-4">Student Number<input className="field" value={form.studentNumber} onChange={(e) => setForm({ ...form, studentNumber: e.target.value })} required /></label>
        )}
        {mode === "register" && (
          <div className="mt-4 flex items-start gap-2 text-sm text-slate-600">
            <input id="signup-agreement" className="mt-1 accent-[#FF6B00]" type="checkbox" name="agreementAccepted" checked={form.agreementAccepted} onInvalid={(event) => event.currentTarget.setCustomValidity(AGREEMENT_REQUIRED_MESSAGE)} onChange={(event) => {
              event.currentTarget.setCustomValidity("");
              setForm({ ...form, agreementAccepted: event.target.checked });
            }} required />
            <label htmlFor="signup-agreement">I have read and agree to the <a className="font-bold text-[#D94F00] underline" href="/legal/terms-and-conditions.html" target="_blank" rel="noopener noreferrer">Terms and Conditions</a> and <a className="font-bold text-[#D94F00] underline" href="/legal/privacy-policy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</label>
          </div>
        )}
        <button className="btn-primary mt-5 w-full px-3 py-3" type="submit">{mode === "login" ? "Login" : "Register"}</button>
        <button className="mt-3 w-full text-sm font-bold text-[#D94F00]" onClick={() => setMode(mode === "login" ? "register" : "login")} type="button">
          {mode === "login" ? "Create teacher or student account" : "Use existing account"}
        </button>
      </form>
      </section>
    </main>
  );
}
