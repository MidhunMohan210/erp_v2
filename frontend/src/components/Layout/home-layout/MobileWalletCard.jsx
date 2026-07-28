import { createElement, useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  AlertCircle,
  Banknote,
  Bell,
  Boxes,
  FileText,
  FileCheck2,
  Loader2,
  Package,
  Users,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import userAvatar from "@/assets/icons/user.png";
import { useLogoutUser } from "@/hooks/mutations/useLogoutUser";
import { useVoucherTotalsSummary } from "@/hooks/queries/voucherQueries";
import { ROUTES } from "@/routes/paths";

import MobileHeaderActions from "./MobileHeaderActions";
import UserIdentityBlock from "./UserIdentityBlock";
import { getInitials, getUserDisplayName } from "./utils";

function QuickActionCard({
  title,
  description,
  icon,
  onClick,
  iconClassName = "",
  className = "",
  wide = false,
  showArrow = true,
  layout = "vertical", // "vertical" | "horizontal"
}) {
  const baseClasses =
    "group relative rounded-2xl border text-left shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md";

  const containerClassName = wide
    ? `${baseClasses} col-span-2 flex h-[72px] items-center justify-between px-4`
    : layout === "vertical"
      ? `${baseClasses} flex h-[82px] flex-col items-start justify-between px-4 py-3`
      : `${baseClasses} flex h-[82px] items-center justify-between px-4`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${containerClassName} ${className}`}
    >
      {wide ? (
        <>
          <div className="flex items-center gap-3">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-2xl ${iconClassName}`}
            >
              {icon ? createElement(icon, { className: "h-4 w-4" }) : null}
            </div>
            <div className="text-left">
              <p className="text-[12px] font-semibold text-slate-900">
                {title}
              </p>
              {description ? (
                <p className="text-[10px] text-slate-500">{description}</p>
              ) : null}
            </div>
          </div>
          {showArrow && (
            <span className="pr-1 text-base leading-none text-slate-300 transition-colors group-hover:text-slate-500">
              {"···"}
            </span>
          )}
        </>
      ) : layout === "vertical" ? (
        <>
          <div className="flex flex-col items-start gap-2 ]">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-2xl ${iconClassName}`}
            >
              {icon ? createElement(icon, { className: "h-4 w-4" }) : null}
            </div>
            <div className="text-left">
              <p className="text-[11px] font-semibold text-slate-900">
                {title}
              </p>
              {description ? (
                <p className="text-[9px] text-slate-500">{description}</p>
              ) : null}
            </div>
          </div>
          {showArrow && (
            <span className="pr-1 text-sm leading-none text-slate-300 transition-colors group-hover:text-slate-500">
              {"···"}
            </span>
          )}
        </>
      ) : (
        // horizontal compact (Statements / Stock register)
        <>
          <div className="flex items-center gap-3">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-2xl ${iconClassName}`}
            >
              {icon ? createElement(icon, { className: "h-4 w-4" }) : null}
            </div>
            <div className="text-left">
              <p className="text-[11px] font-semibold text-slate-900">
                {title}
              </p>
              {description ? (
                <p className="text-[9px] text-slate-500">{description}</p>
              ) : null}
            </div>
          </div>
          {showArrow && (
            <span className="pr-1 text-sm leading-none text-slate-300 transition-colors group-hover:text-slate-500">
              {"···"}
            </span>
          )}
        </>
      )}
    </button>
  );
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

export default function MobileWalletCard({
  headerOptions,
  selectedCompany,
  onCompanyClick,
}) {
  const navigate = useNavigate();
  const user = useSelector((state) => state.auth.user);
  const selectedCompanyId = useSelector(
    (state) => state.company.selectedCompanyId,
  );
  const displayName = getUserDisplayName(user);
  const initials = getInitials(displayName);
  const { logoutUser } = useLogoutUser();
  const [activeTotalType, setActiveTotalType] = useState("saleOrder");
  const [touchStartX, setTouchStartX] = useState(null);
  const isAdminUser = user?.role === "admin";
  const totalsSummaryQuery = useVoucherTotalsSummary(selectedCompanyId, {
    enabled: Boolean(selectedCompanyId),
    staleTime: isAdminUser ? 10 * 60 * 1000 : 30 * 1000,
    gcTime: isAdminUser ? 20 * 60 * 1000 : 10 * 60 * 1000,
    refetchInterval: isAdminUser ? 10 * 60 * 1000 : false,
  });
  const totals = totalsSummaryQuery.data?.totals || {
    saleOrder: 0,
    receipt: 0,
  };

  const totalCards = useMemo(
    () => [
      {
        key: "saleOrder",
        label: "Sale Order Total",
        value: totals.saleOrder,
        helper: "Swipe to switch voucher total",
      },
      {
        key: "receipt",
        label: "Receipt Total",
        value: totals.receipt,
        helper: "Receipt total will appear here",
      },
    ],
    [totals.receipt, totals.saleOrder],
  );

  const activeIndex = totalCards.findIndex(
    (card) => card.key === activeTotalType,
  );
  const activeCard = totalCards[activeIndex] || totalCards[0];

  const onLogout = useCallback(() => {
    logoutUser()
      .then(() => {
        navigate(ROUTES.login, { replace: true });
      })
      .catch(() => {});
  }, [logoutUser, navigate]);

  const walletHeaderOptions = useMemo(
    () => ({
      ...headerOptions,
      menuItems: [
        ...(headerOptions?.menuItems || []),
        { label: "Logout", onSelect: onLogout },
      ],
    }),
    [headerOptions, onLogout],
  );

  const showPreviousTotal = useCallback(() => {
    setActiveTotalType((current) =>
      current === "receipt" ? "saleOrder" : current,
    );
  }, []);

  const showNextTotal = useCallback(() => {
    setActiveTotalType((current) =>
      current === "saleOrder" ? "receipt" : current,
    );
  }, []);

  const handleTouchStart = useCallback((event) => {
    setTouchStartX(event.touches?.[0]?.clientX ?? null);
  }, []);

  const handleTouchEnd = useCallback(
    (event) => {
      if (touchStartX == null) return;

      const touchEndX = event.changedTouches?.[0]?.clientX ?? null;
      if (touchEndX == null) {
        setTouchStartX(null);
        return;
      }

      const deltaX = touchEndX - touchStartX;

      if (deltaX > 40) {
        showPreviousTotal();
      } else if (deltaX < -40) {
        showNextTotal();
      }

      setTouchStartX(null);
    },
    [showNextTotal, showPreviousTotal, touchStartX],
  );

  return (
    <div className="bg-linear-to-b from-blue-800 to-indigo-600 text-white">
      <div className="relative overflow-hidden bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-700 text-white">
        <svg
          className="absolute inset-0 h-full w-full opacity-[0.07]"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern
              id="dots"
              x="0"
              y="0"
              width="24"
              height="24"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="2" cy="2" r="1.5" fill="white" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dots)" />
        </svg>

        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-blue-500/30 blur-3xl" />
        <div className="absolute -bottom-6 -left-6 h-28 w-28 rounded-full bg-indigo-400/20 blur-2xl" />

        <div className="relative p-5">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10 border border-white/30 bg-white/10">
                <AvatarImage src={userAvatar} alt={displayName} />
                <AvatarFallback className="bg-white/15 text-sm font-semibold text-white">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <UserIdentityBlock
                displayName={displayName}
                selectedCompany={selectedCompany}
                onCompanyClick={onCompanyClick}
                tone="dark"
              />
            </div>

            <div className="flex items-center gap-2">
              {/* <button
                type="button"
                className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white/10 backdrop-blur-sm transition-colors hover:bg-white/20"
              >
                <Bell className="h-4 w-4" />
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-sky-400 ring-1 ring-blue-900" />
              </button> */}
              <MobileHeaderActions options={walletHeaderOptions} tone="dark" />
            </div>
          </div>

          <div
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            className="relative mb-5 block w-full overflow-hidden rounded-2xl border border-white/10 bg-white/10 py-6 text-center backdrop-blur-sm transition-colors hover:bg-white/15"
          >
            <div className="absolute left-1/4 right-1/4 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
            <p className="mb-1 text-[11px] uppercase tracking-wide text-blue-200">
              Total Balance
            </p>
            <p className="text-[11px] font-medium text-blue-100">
              {activeCard.label}
            </p>
            <p className="text-3xl font-bold tracking-tight">
              {totalsSummaryQuery.isLoading ? (
                <span className="inline-flex min-h-9 items-center justify-center">
                  <Loader2 className="h-7 w-7 animate-spin text-blue-100" />
                </span>
              ) : (
                formatCurrency(activeCard.value)
              )}
            </p>
            <p className="mt-1 text-[11px] text-blue-300">
              {totalsSummaryQuery.isError
                ? "Unable to load total right now"
                : activeCard.helper}
            </p>
            <div className="mt-3 flex items-center justify-center gap-2">
              {totalCards.map((card) => (
                <span
                  key={card.key}
                  className={`h-1.5 rounded-full transition-all ${
                    card.key === activeCard.key
                      ? "w-5 bg-white"
                      : "w-1.5 bg-white/45"
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              type="button"
              onClick={() => navigate(ROUTES.createOrder)}
              className="flex-1 rounded-xl border border-sky-400/30 bg-sky-500/90 py-5 text-[13px] font-semibold text-white shadow-md shadow-sky-900/30 transition-all hover:-translate-y-0.5 hover:bg-sky-500"
            >
              Create Order
            </Button>
            <Button
              type="button"
              onClick={() => navigate(ROUTES.createReceipt)}
              className="flex-1 rounded-xl border border-rose-400/30 bg-rose-500/90 py-5 text-[13px] font-semibold text-white shadow-md shadow-rose-900/30 transition-all hover:-translate-y-0.5 hover:bg-rose-500"
            >
              Create Receipt
            </Button>
          </div>
        </div>
      </div>

      <Card className="w-full rounded-b-none rounded-t-[30px] border-none bg-white pt-6 text-slate-900 shadow-none ring-0">
        <CardHeader className="pb-2" />
        <CardContent className="space-y-4 pb-7">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Quick Actions
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <QuickActionCard
              title="Customers"
              description="Manage parties"
              icon={Users}
              onClick={() => navigate(ROUTES.mastersCustomers)}
              iconClassName="bg-amber-100 text-amber-600"
              className="border-amber-100 bg-gradient-to-br from-amber-50 to-white !h-26"
              layout="vertical" // icon top, text below
            />

            <QuickActionCard
              title="Products"
              description="Catalog items"
              icon={Package}
              onClick={() => navigate(ROUTES.mastersProducts)}
              iconClassName="bg-pink-100 text-pink-600"
              className="border-pink-100 bg-gradient-to-br from-pink-50 to-white  !h-26"
              layout="vertical"
            />
            <QuickActionCard
              title="Daybook"
              icon={FileText}
              onClick={() => navigate(ROUTES.daybook)}
              iconClassName="rounded-xl bg-indigo-100 text-indigo-500"
              className="border-slate-100 bg-white !h-18"
              wide
              showArrow={true}
            />

           

            <QuickActionCard
              title="Outstandings"
              description="Pending dues"
              icon={AlertCircle}
              onClick={() => navigate(ROUTES.outstanding)}
              iconClassName="rounded-xl bg-red-100 text-red-500"
              className="border-slate-100 bg-white !h-18"
               layout="horizontal"
            />

            {/* <QuickActionCard
              title="Stock register"
              icon={Boxes}
              onClick={() => navigate(ROUTES.stockRegister)}
              iconClassName="rounded-xl bg-green-100 text-green-500"
              className="border-slate-100 bg-white !h-18"
              layout="horizontal"
              showArrow={true}
            /> */}

            <QuickActionCard
              title="Cash / Bank"
              description="Ledger & balance"
              icon={Banknote}
              onClick={() => navigate(ROUTES.CashBankBalancePage)}
              iconClassName="rounded-xl bg-teal-100 text-teal-500"
              className="border-slate-100 bg-gradient-to-r from-teal-50/80 to-white  !h-18"
              layout="horizontal" // icon + text in a row
              showArrow={true}
            />

             <QuickActionCard
              title="Billed Orders"
              description="Completed sale orders"
              icon={FileCheck2}
              onClick={() => navigate(ROUTES.convertedOrders)}
              iconClassName="rounded-xl bg-emerald-100 text-emerald-600"
              className="border-slate-100 bg-white !h-18"
              layout="horizontal"
              wide
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
