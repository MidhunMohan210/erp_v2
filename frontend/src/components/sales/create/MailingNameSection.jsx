import { Mail } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";

import SectionCard from "@/components/sales/create/SectionCard";
import { setMailingName } from "@/store/slices/transactionSlice";

// Editable correspondence name. Party selection initializes this value, while
// keeping it independent so the user can address the order differently.
export default function MailingNameSection() {
  const dispatch = useDispatch();
  const mailingName = useSelector((state) => state.transaction.mailingName);
  const party = useSelector((state) => state.transaction.party);

  return (
    <SectionCard
      title="Mailing name"
      subtitle="Name to use for correspondence"
      icon={Mail}
      tone="violet"
    >
      <div className="space-y-1">
        <label
          htmlFor="sale-order-mailing-name"
          className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500"
        >
          Mailing name
        </label>
        <input
          id="sale-order-mailing-name"
          type="text"
          maxLength={200}
          value={mailingName || ""}
          onChange={(event) => dispatch(setMailingName(event.target.value))}
          placeholder={
            party?.partyName
              ? "Enter mailing name"
              : "Select a party to fill the mailing name"
          }
          className="w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-3 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
        />
      </div>
    </SectionCard>
  );
}
