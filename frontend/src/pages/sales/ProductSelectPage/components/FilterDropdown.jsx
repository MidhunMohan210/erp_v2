import { ChevronDown } from "lucide-react";
import { getMasterOptionId, getMasterOptionLabel } from "../utils/productSelectionHelpers";

export default function FilterDropdown({ label, value, onChange, options, placeholder, disabled = false }) {
  return <div className="space-y-2"><label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</label><div className="relative"><select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-12 w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 pr-10 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"><option value="">{placeholder}</option>{options.map((option) => { const v = getMasterOptionId(option); return <option key={v} value={v}>{getMasterOptionLabel(option)}</option>; })}</select><ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /></div></div>;
}
