// src/components/outstanding/LedgerFilter.jsx
export function LedgerFilter({ value, onChange, className = "" }) {
  const options = [
    { value: "ledger", label: "Ledger" },
    { value: "payable", label: "Payables" },
    { value: "receivable", label: "Receivables" },
  ];

  return (
    <div
      className={`grid w-full grid-cols-3 gap-1 rounded-lg bg-slate-200/70 p-1 ${className}`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={`min-w-0 rounded-md px-2 py-2 text-[11px] font-semibold transition ${
            value === option.value
              ? "bg-white text-slate-800 shadow-sm ring-1 ring-slate-200"
              : "text-slate-500 hover:bg-white/60 hover:text-slate-700"
          }`}
        >
          <span className="block truncate">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
