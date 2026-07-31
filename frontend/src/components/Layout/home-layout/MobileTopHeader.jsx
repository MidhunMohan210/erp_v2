import { ChevronLeft } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import ListSearchBar from "@/components/common/ListSearchBar";
import { useLogoutUser } from "@/hooks/mutations/useLogoutUser";
import { ROUTES } from "@/routes/paths";

import MobileHeaderActions from "./MobileHeaderActions";

export default function MobileTopHeader({
  isHome,
  title,
  headerOptions,
  forceShowOnHome = false,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { logoutUser } = useLogoutUser();
  const searchOptions = headerOptions?.search;
  const showSearch = Boolean(searchOptions?.show ?? searchOptions);
  const prominent = Boolean(headerOptions?.prominent);

  const effectiveHeaderOptions =
    isHome && forceShowOnHome
      ? {
          ...headerOptions,
          showMenuDots: true,
          menuItems: [
            ...(headerOptions?.menuItems || []),
            {
              label: "Logout",
              onSelect: () => {
                logoutUser()
                  .then(() => {
                    navigate(ROUTES.login, { replace: true });
                  })
                  .catch(() => {});
              },
            },
          ],
        }
      : headerOptions;

  const actionButtons = effectiveHeaderOptions?.actionButtons ?? [];
  const customOnBack = effectiveHeaderOptions?.onBack;
  const primaryActionButtons = actionButtons.filter(
    (action) => action?.primaryButton,
  );
  const secondaryActionButtons = actionButtons.filter(
    (action) => !action?.primaryButton,
  );

  if (isHome && !forceShowOnHome) return null;

  const onBack = () => {
    if (typeof customOnBack === "function") {
      customOnBack();
      return;
    }

    const backRouteMap = {
      [ROUTES.createOrder]: ROUTES.home,
      [ROUTES.salesSelectItems]:
        location.state?.returnTo || ROUTES.createOrder,
      [ROUTES.mastersCompany]: ROUTES.home,
      [ROUTES.mastersUsers]: ROUTES.home,
      [ROUTES.mastersCustomers]: ROUTES.home,
      [ROUTES.mastersProducts]: ROUTES.home,
      [ROUTES.mastersPartyList]: ROUTES.home,
      [ROUTES.mastersCompanyRegister]: ROUTES.mastersCompany,
      [ROUTES.mastersUserRegister]: ROUTES.mastersUsers,
      [ROUTES.mastersPartyRegister]: ROUTES.mastersPartyList,
    };

    if (location.pathname.startsWith("/sale-orders/")) {
      navigate(ROUTES.createOrder, { replace: true });
      return;
    }

    const targetRoute = backRouteMap[location.pathname];
    if (targetRoute) {
      navigate(targetRoute, { replace: true });
      return;
    }

    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate(ROUTES.home, { replace: true });
  };

  return (
    <header
      className={`sticky top-0 z-20 bg-white px-4 text-slate-900 ${
        prominent ? "pb-2 pt-4" : "pt-4"
      }`}
    >
      <div className="w-full">
        <div
          className={`relative flex w-full items-center justify-between ${
            prominent ? "min-h-7" : ""
          }`}
        >
          <button
            type="button"
            onClick={onBack}
            aria-label="Go back"
            className={
              prominent
                ? "inline-flex h-7 w-7 items-center justify-center"
                : undefined
            }
          >
            <ChevronLeft
              className={`font-extrabold text-blue-600 ${
                prominent ? "h-5 w-5" : "h-4 w-4"
              }`}
            />
          </button>
          <h1
            className={`pointer-events-none absolute left-1/2 -translate-x-1/2 text-slate-900 ${
              prominent ? "text-sm font-bold" : "text-sm font-bold"
            }`}
          >
            {title}
          </h1>
          <div
            className={`flex justify-end ${prominent ? "min-w-8" : "min-w-9"}`}
          >
            {effectiveHeaderOptions?.showMenuDots ? (
              <MobileHeaderActions
                options={{ ...effectiveHeaderOptions, actionButtons: [] }}
                tone="light"
              />
            ) : null}
          </div>
        </div>

        {(actionButtons.length > 0 || showSearch) && (
          <div className="pt-3 mt-3">
            {actionButtons.length > 0 && (
              <div className="flex items-center justify-between gap-3 pb-3">
                <div className="flex min-w-0 items-center gap-2">
                  {primaryActionButtons.length > 0 ? (
                    <MobileHeaderActions
                      options={{
                        ...effectiveHeaderOptions,
                        actionButtons: primaryActionButtons,
                        showMenuDots: false,
                        menuItems: [],
                      }}
                      tone="light"
                    />
                  ) : null}
                </div>
                <div className="flex min-w-0 items-center justify-end gap-2">
                  {secondaryActionButtons.length > 0 ? (
                    <MobileHeaderActions
                      options={{
                        ...effectiveHeaderOptions,
                        actionButtons: secondaryActionButtons,
                        showMenuDots: false,
                        menuItems: [],
                      }}
                      tone="light"
                    />
                  ) : null}
                </div>
              </div>
            )}

            {showSearch && (
              <div className="mx-auto w-full max-w-md pb-3">
                <ListSearchBar
                  value={searchOptions?.value ?? ""}
                  onChange={searchOptions?.onChange ?? (() => {})}
                  placeholder={searchOptions?.placeholder || "Search"}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
