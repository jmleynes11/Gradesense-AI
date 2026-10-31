const styles = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  published: "bg-green-50 text-green-700 border-green-200",
  closed: "bg-slate-100 text-slate-700 border-slate-200",
  archived: "bg-slate-100 text-slate-500 border-slate-200",
  active: "bg-[#FFF3E8] text-[#D94F00] border-[#FFE4CC]",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  graded: "bg-green-50 text-green-700 border-green-200",
  correct: "bg-green-50 text-green-700 border-green-200",
  incorrect: "bg-red-50 text-red-700 border-red-200",
  excellent: "bg-green-50 text-green-700 border-green-200",
  average: "bg-amber-50 text-amber-700 border-amber-200",
  "at risk": "bg-red-50 text-red-700 border-red-200",
  "ai generated": "bg-[#FFF3E8] text-[#D94F00] border-[#FFE4CC]",
  "ai insight": "bg-[#FFF3E8] text-[#D94F00] border-[#FFE4CC]",
  "ai recommendation": "bg-[#FFF3E8] text-[#D94F00] border-[#FFE4CC]",
  "ai assisted": "bg-[#FFF3E8] text-[#D94F00] border-[#FFE4CC]",
  "teacher reviewed": "bg-slate-100 text-slate-700 border-slate-200",
  completed: "bg-green-50 text-green-700 border-green-200",
  missing: "bg-red-50 text-red-700 border-red-200",
  "not started": "bg-slate-100 text-slate-700 border-slate-200",
  "in progress": "bg-[#FFF3E8] text-[#D94F00] border-[#FFE4CC]",
  easy: "bg-green-50 text-green-700 border-green-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  hard: "bg-red-50 text-red-700 border-red-200"
};

function labelize(value = "") {
  return String(value || "Pending").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function StatusBadge({ value, label: displayLabel, icon, className = "" }) {
  const label = labelize(value);
  const key = label.toLowerCase();
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${styles[key] || styles.pending} ${className}`}>
      {icon}
      {displayLabel ?? label}
    </span>
  );
}
