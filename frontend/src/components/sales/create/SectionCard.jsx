/**
 * Shared card wrapper for sale-order create/edit sections.
 *
 * @param {{
 *   title: string,
 *   required?: boolean,
 *   subtitle?: string,
 *   icon?: React.ComponentType,
 *   tone?: "slate"|"blue"|"amber"|"teal"|"violet",
 *   children: React.ReactNode
 * }} props
 * @returns {JSX.Element}
 */
export default function SectionCard({
  title,
  required,
  subtitle,
  icon: Icon,
  tone = "slate",
  children,
}) {
  const tones = {
    slate: {
      icon: "border-slate-200 bg-slate-50 text-slate-700",
      card: "border-slate-200 bg-white",
    },
    blue: {
      icon: "border-sky-200 bg-sky-50 text-sky-700",
      card: "border-sky-100 bg-white",
    },
    amber: {
      icon: "border-amber-200 bg-amber-50 text-amber-700",
      card: "border-amber-100 bg-white",
    },
    teal: {
      icon: "border-teal-200 bg-teal-50 text-teal-700",
      card: "border-teal-100 bg-white",
    },
    violet: {
      icon: "border-violet-200 bg-violet-50 text-violet-700",
      card: "border-violet-100 bg-white",
    },
  };
  const currentTone = tones[tone] || tones.slate;

  return (
    <section
      className={`rounded-sm border ${currentTone.card} shadow-[0_10px_30px_-24px_rgba(15,23,42,0.35)]`}
    >
      <header className="flex items-start justify-between border-b border-slate-100 px-3 py-3.5">
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-xl border ${currentTone.icon}`}
          >
            {Icon ? <Icon className="h-4.5 w-4.5" /> : null}
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {title}
              {required && <span className="ml-1 text-rose-500">*</span>}
            </p>
            {subtitle && (
              <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
            )}
          </div>
        </div>
      </header>
      <div className="px-3 py-4">{children}</div>
    </section>
  );
}
