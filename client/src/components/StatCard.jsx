export default function StatCard({ label, value, helper, icon: Icon, tone = "default" }) {
  const toneClass = tone === "ai" ? "bg-[#FFF3E8] text-[#D94F00]" : "bg-slate-100 text-slate-700";
  return (
    <div className="premium-card p-4 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{value ?? 0}</p>
        </div>
        {Icon && (
          <span className={`grid h-10 w-10 place-items-center rounded-lg ${toneClass}`}>
            <Icon size={19} />
          </span>
        )}
      </div>
      {helper && <p className="mt-3 text-sm text-slate-500">{helper}</p>}
    </div>
  );
}
