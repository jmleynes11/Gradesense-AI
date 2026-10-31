export default function SimpleTable({ columns, rows }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {columns.map((column) => (
              <th className="px-4 py-3 font-bold" key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {(rows || []).map((row, index) => (
            <tr className="transition hover:bg-[#FFF3E8]/50" key={row._id || index}>
              {columns.map((column) => (
                <td className="px-4 py-3 align-top text-slate-700" key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!(rows || []).length && (
        <div className="px-4 py-8 text-center text-sm text-slate-500">No records to display.</div>
      )}
    </div>
  );
}
