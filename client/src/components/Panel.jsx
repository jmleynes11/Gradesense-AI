export default function Panel({ title, eyebrow, children, actions, className = "" }) {
  return (
    <section className={`premium-card ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          {eyebrow && <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#D94F00]">{eyebrow}</p>}
          <h2 className="text-base font-bold text-slate-950">{title}</h2>
        </div>
        {actions}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}
