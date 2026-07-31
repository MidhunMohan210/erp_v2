import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";

import {
  clearSelectedCompany,
  setSelectedCompany,
  setSelectedCompanyId,
} from "@/store/slices/companySlice";
import {
  useCompanyByIdQuery,
  useCompanyOptionsQuery,
} from "@/hooks/queries/companyQueries";
import { ROUTES } from "@/routes/paths";
import {
  clearSavedDaybookFilters,
  resetSaleOrderDraft,
} from "@/store/slices/transactionSlice";
import { clearSaleOrderDraftStorage } from "@/utils/transactionStorage";

import CompanyDrawer from "./home-layout/CompanyDrawer";
import CompanySwitchOverlay from "./home-layout/CompanySwitchOverlay";
import { DEFAULT_MOBILE_HEADER_OPTIONS } from "./home-layout/constants";
import { MobileHeaderContext, useMobileHeaderContext } from "./home-layout/context";
import DesktopShell from "./home-layout/DesktopShell";
import MobileShell from "./home-layout/MobileShell";

function isSaleOrderContextPath(pathname) {
  if (!pathname) return false;

  return (
    pathname === ROUTES.createOrder ||
    pathname === ROUTES.salesSelectItems ||
    /^\/sale-orders\/[^/]+\/edit$/.test(pathname)
  );
}

function isDaybookContextPath(pathname) {
  if (!pathname) return false;

  return (
    pathname === ROUTES.daybook ||
    pathname === ROUTES.convertedOrders ||
    /^\/transactions\/[^/]+\/[^/]+$/.test(pathname)
  );
}

function isBottomTabPath(pathname) {
  return [
    ROUTES.home,
    ROUTES.mastersCompany,
    ROUTES.mastersUsers,
    ROUTES.settings,
  ].includes(pathname);
}

// Keeps route-level header state and company selection state in one place.
function useHomeLayoutState() {
  const dispatch = useDispatch();
  const location = useLocation();
  const previousPathnameRef = useRef(location.pathname);
  const user = useSelector((state) => state.auth.user);
  const isLoggedIn = useSelector((state) => state.auth.isLoggedIn);
  const selectedCompanyId = useSelector(
    (state) => state.company.selectedCompanyId,
  );
  const selectedCompany = useSelector((state) => state.company.selectedCompany);
  const transactionCompanyId = useSelector((state) => state.transaction.cmp_id);
  const role = user?.role || "staff";
  const canCreateCompany = role === "admin";
  const [headerOptionsByPath, setHeaderOptionsByPath] = useState({});
  const [isCompanyDrawerOpen, setIsCompanyDrawerOpen] = useState(false);
  const [switchingCompanyId, setSwitchingCompanyId] = useState(null);
  const [switchingCompanyName, setSwitchingCompanyName] = useState("");
  const companiesEnabled = Boolean(isLoggedIn && user);

  const { data: companies = [], isLoading: isCompaniesLoading } =
    useCompanyOptionsQuery(companiesEnabled);

  const hasCompany = companies.length > 0;

  const effectiveSelectedCompanyId = useMemo(() => {
    if (!companies.length) return null;

    if (
      selectedCompanyId &&
      companies.some((company) => company.id === selectedCompanyId)
    ) {
      return selectedCompanyId;
    }

    return companies[0].id;
  }, [companies, selectedCompanyId]);

  const { data: selectedCompanyDetails } = useCompanyByIdQuery(
    effectiveSelectedCompanyId,
    companiesEnabled,
  );

  useEffect(() => {
    if (!companiesEnabled || isCompaniesLoading) return;

    if (!effectiveSelectedCompanyId) {
      if (selectedCompanyId || selectedCompany) {
        dispatch(clearSelectedCompany());
      }
      return;
    }

    if (selectedCompanyId !== effectiveSelectedCompanyId) {
      dispatch(setSelectedCompanyId(effectiveSelectedCompanyId));
    }
  }, [
    companiesEnabled,
    dispatch,
    effectiveSelectedCompanyId,
    isCompaniesLoading,
    selectedCompany,
    selectedCompanyId,
  ]);

  useEffect(() => {
    if (!selectedCompanyDetails) return;

    dispatch(setSelectedCompany(selectedCompanyDetails));
  }, [dispatch, selectedCompanyDetails]);

  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    const currentPathname = location.pathname;

    if (
      previousPathname !== currentPathname &&
      isSaleOrderContextPath(previousPathname) &&
      !isSaleOrderContextPath(currentPathname)
    ) {
      clearSaleOrderDraftStorage(transactionCompanyId || selectedCompanyId);
      dispatch(resetSaleOrderDraft());
    }

    if (
      previousPathname !== currentPathname &&
      isDaybookContextPath(previousPathname) &&
      isBottomTabPath(currentPathname)
    ) {
      dispatch(clearSavedDaybookFilters());
    }

    previousPathnameRef.current = currentPathname;
  }, [dispatch, location.pathname, selectedCompanyId, transactionCompanyId]);

  useEffect(() => {
    if (!switchingCompanyId || !selectedCompanyDetails) return;

    const resolvedCompanyId =
      selectedCompanyDetails?._id || selectedCompanyDetails?.id || null;

    if (resolvedCompanyId !== switchingCompanyId) return;

    const timeoutId = window.setTimeout(() => {
      setSwitchingCompanyId(null);
      setSwitchingCompanyName("");
    }, 1000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [selectedCompanyDetails, switchingCompanyId]);

  const selectedCompanyForUi = useMemo(() => {
    const selectedId = effectiveSelectedCompanyId;
    if (!selectedId) return null;

    if ((selectedCompany?._id || selectedCompany?.id) === selectedId) {
      return selectedCompany;
    }

    return companies.find((company) => company.id === selectedId) || null;
  }, [companies, effectiveSelectedCompanyId, selectedCompany]);

  const setHeaderOptionsForPath = useCallback((pathname, options) => {
    setHeaderOptionsByPath((prev) => ({
      ...prev,
      [pathname]: {
        ...DEFAULT_MOBILE_HEADER_OPTIONS,
        ...prev[pathname],
        ...options,
      },
    }));
  }, []);

  const resetHeaderOptionsForPath = useCallback((pathname) => {
    setHeaderOptionsByPath((prev) => {
      if (!prev[pathname]) return prev;

      const next = { ...prev };
      delete next[pathname];
      return next;
    });
  }, []);

  const openCompanyDrawer = useCallback(() => {
    setIsCompanyDrawerOpen(true);
  }, []);

  const closeCompanyDrawer = useCallback(() => {
    setIsCompanyDrawerOpen(false);
  }, []);

  const handleSelectCompany = useCallback(
    (company) => {
      const nextCompanyId = company?.id || null;

      if (!nextCompanyId || nextCompanyId === effectiveSelectedCompanyId) {
        setIsCompanyDrawerOpen(false);
        return;
      }

      setSwitchingCompanyId(nextCompanyId);
      setSwitchingCompanyName(company?.name || "");
      dispatch(setSelectedCompanyId(nextCompanyId));
      setIsCompanyDrawerOpen(false);
    },
    [dispatch, effectiveSelectedCompanyId],
  );

  const mobileHeaderContextValue = useMemo(
    () => ({
      headerOptionsByPath,
      setHeaderOptionsForPath,
      resetHeaderOptionsForPath,
    }),
    [headerOptionsByPath, resetHeaderOptionsForPath, setHeaderOptionsForPath],
  );

  return {
    canCreateCompany,
    closeCompanyDrawer,
    companies,
    headerOptionsByPath,
    handleSelectCompany,
    hasCompany,
    isCheckingCompanies: isCompaniesLoading && companiesEnabled,
    isCompanyDrawerOpen,
    mobileHeaderContextValue,
    openCompanyDrawer,
    role,
    selectedCompanyForUi,
    switchingCompanyId,
    switchingCompanyName,
  };
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMobileHeader() {
  const { pathname } = useLocation();
  const { setHeaderOptionsForPath, resetHeaderOptionsForPath } =
    useMobileHeaderContext();

  const setHeaderOptions = useCallback(
    (options) => {
      setHeaderOptionsForPath(pathname, options);
    },
    [pathname, setHeaderOptionsForPath],
  );

  const resetHeaderOptions = useCallback(() => {
    resetHeaderOptionsForPath(pathname);
  }, [pathname, resetHeaderOptionsForPath]);

  return { setHeaderOptions, resetHeaderOptions };
}

export default function HomeLayout() {
  const {
    canCreateCompany,
    closeCompanyDrawer,
    companies,
    handleSelectCompany,
    hasCompany,
    isCheckingCompanies,
    isCompanyDrawerOpen,
    mobileHeaderContextValue,
    openCompanyDrawer,
    role,
    selectedCompanyForUi,
    switchingCompanyId,
    switchingCompanyName,
  } = useHomeLayoutState();

  return (
    <MobileHeaderContext.Provider value={mobileHeaderContextValue}>
      <DesktopShell
        selectedCompany={selectedCompanyForUi}
        onCompanyClick={openCompanyDrawer}
        hasCompany={hasCompany}
        isCheckingCompanies={isCheckingCompanies}
        role={role}
        canCreateCompany={canCreateCompany}
      />
      <MobileShell
        selectedCompany={selectedCompanyForUi}
        onCompanyClick={openCompanyDrawer}
        hasCompany={hasCompany}
        isCheckingCompanies={isCheckingCompanies}
        role={role}
        canCreateCompany={canCreateCompany}
      />
      <CompanyDrawer
        open={isCompanyDrawerOpen}
        selectedCompany={selectedCompanyForUi}
        companies={companies}
        loading={isCheckingCompanies}
        onClose={closeCompanyDrawer}
        onSelectCompany={handleSelectCompany}
      />
      <CompanySwitchOverlay
        open={Boolean(switchingCompanyId)}
        companyName={switchingCompanyName}
      />
    </MobileHeaderContext.Provider>
  );
}
