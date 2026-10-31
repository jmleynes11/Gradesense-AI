export default function LoadingState({ label = "Loading data", error = "" }) {
  if (error) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">{error}</div>;
  return <section role="status" aria-live="polite" aria-busy="true" className="rounded-xl border border-slate-200 bg-white p-6">
    <p className="mb-5 font-semibold text-slate-700">{label}…</p>
    <div aria-hidden="true" className="space-y-3 animate-pulse motion-reduce:animate-none">
      <div className="h-5 w-2/3 rounded bg-slate-100" />
      <div className="h-4 w-full rounded bg-slate-100" />
      <div className="h-4 w-5/6 rounded bg-slate-100" />
    </div>
  </section>;
}
