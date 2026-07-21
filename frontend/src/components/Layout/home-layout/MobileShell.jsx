import { Outlet, useLocation } from "react-router-dom";

import { ROUTES } from "@/routes/paths";

import { DEFAULT_MOBILE_HEADER_OPTIONS } from "./constants";
import { useMobileHeaderContext } from "./context";
import MobileBottomBar from "./MobileBottomBar";
import MobileTopHeader from "./MobileTopHeader";
import MobileWalletCard from "./MobileWalletCard";
import NoCompanyScreen from "./NoCompanyScreen";
import { getPageTitle, isHomePath } from "./utils";

// MobileShell decides which mobile experience to show for the current route.
export default function MobileShell({
  selectedCompany,
  onCompanyClick,
  hasCompany,
  isCheckingCompanies,
  role,
  canCreateCompany,
}) {
  const { pathname } = useLocation();
  const { headerOptionsByPath } = useMobileHeaderContext();
  const isHome = isHomePath(pathname);
  const title = getPageTitle(pathname);
  const headerOptions =
    headerOptionsByPath[pathname] ?? DEFAULT_MOBILE_HEADER_OPTIONS;
  const isCompanyRegister = pathname === ROUTES.mastersCompanyRegister;
  const showBottomBar = [
    ROUTES.home,
    ROUTES.mastersCompany,
    ROUTES.mastersUsers,
    ROUTES.settings,
  ].includes(pathname);
  const showNoCompanyScreen =
    !isCheckingCompanies && !hasCompany && !isCompanyRegister;

  return (
    <div className="min-h-screen bg-slate-50 md:hidden">
      <div className="mx-auto min-h-screen w-full max-w-md bg-white shadow-sm">
        <MobileTopHeader
          isHome={isHome}
          title={title}
          headerOptions={headerOptions}
          forceShowOnHome={isHome && showNoCompanyScreen}
        />

        <main className={showBottomBar ? "pb-[104px]" : "pb-4"}>
          {isCheckingCompanies ? (
            <div
              className={`flex items-center justify-center ${
                showBottomBar
                  ? "min-h-[calc(100vh-104px)]"
                  : "min-h-[calc(100vh-56px)]"
              }`}
            >
              <p className="text-sm text-slate-500">Checking your companies...</p>
            </div>
          ) : showNoCompanyScreen ? (
            <NoCompanyScreen role={role} canCreate={canCreateCompany} />
          ) : isHome ? (
            <>
              <MobileWalletCard
                headerOptions={headerOptions}
                selectedCompany={selectedCompany}
                onCompanyClick={onCompanyClick}
              />
              <div className="mt-4 px-4">
                <Outlet />
              </div>
            </>
          ) : (
            <div className="px-3 py-2">
              <Outlet />
            </div>
          )}
        </main>

        {showBottomBar ? <MobileBottomBar /> : null}
      </div>
    </div>
  );
}
