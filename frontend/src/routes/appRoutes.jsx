import { lazy } from "react";
import { Navigate, Route } from "react-router-dom";

import ProtectedRoute from "@/components/Layout/ProtectedRoute";
import { ROUTES } from "@/routes/paths";
const CashInHandListPage = lazy(
  () => import("@/pages/party/CashInHandListPage"),
);
const BankBalanceListPage = lazy(
  () => import("@/pages/party/BankBalanceListPage"),
);

const HomeLayout = lazy(() => import("@/components/Layout/HomeLayout"));
const HomePage = lazy(() => import("@/pages/Home/HomePage"));
const UserPage = lazy(() => import("@/pages/Home/UserPage"));
const SettingsPage = lazy(() => import("@/pages/settings/settings"));
const OutstandingsPage = lazy(
  () => import("@/pages/oustanding/OutstandingPartyListPage"),
);
const DaybookPage = lazy(() => import("@/pages/Home/DaybookPage"));
const ConvertedOrdersPage = lazy(
  () => import("@/pages/Home/ConvertedOrdersPage"),
);
const StockRegisterPage = lazy(() => import("@/pages/Home/StockRegisterPage"));
const CashBankBalancePage = lazy(
  () => import("@/pages/party/CashBankBalancePage"),
);
const TransactionDetailPage = lazy(
  () => import("@/pages/transactions/TransactionDetailPage"),
);
const SaleOrderCreatePage = lazy(
  () => import("@/pages/sales/SaleOrderCreatePage"),
);
const SaleOrderDetailPage = lazy(() => import("@/pages/sales/SaleOrderDetailPage"));
const SaleOrderEditPage = lazy(() => import("@/pages/sales/SaleOrderEditPage"));
const ProductSelectPage = lazy(() => import("@/pages/sales/ProductSelectPage"));
const CreateReceiptPage = lazy(() => import("@/pages/Home/CreateReceiptPage"));
const UserCreatePage = lazy(() => import("@/pages/users/UserCreatePage"));
const UserListPage = lazy(() => import("@/pages/users/UserListPage"));
const OutstandingPartyDetailPage = lazy(
  () => import("@/pages/oustanding/OutstandingPartyDetailPage"),
);

const DataEntrySettingsPage = lazy(
  () => import("@/pages/settings/DataEntrySettings"),
);
const DataEntryVoucherSettingsPage = lazy(
  () => import("@/pages/settings/DataEntryVoucherSettings"),
);
const DataEntryOrderSettingsPage = lazy(
  () => import("@/pages/settings/DataEntryOrderSettings"),
);
const DataEntryReceiptSettingsPage = lazy(
  () => import("@/pages/settings/DataEntryReceiptSettings"),
);
const VoucherSettingsPage = lazy(
  () => import("@/pages/settings/VoucherSettings"),
);
const VoucherSeriesSettingsPage = lazy(
  () => import("@/pages/settings/VoucherSeriesSettings"),
);
const VoucherSeriesListPage = lazy(
  () => import("@/pages/settings/VoucherSeriesList"),
);
const PrintConfigurationsPage = lazy(
  () => import("@/pages/settings/PrintConfigurations"),
);
const IntegrationsPage = lazy(() => import("@/pages/settings/IntegrationsScreen"));
const PrintConfigDetailPage = lazy(
  () => import("@/pages/settings/PrintConfigDetail"),
);

const CreateVoucherSeriesPage = lazy(
  () => import("@/pages/settings/CreateVoucherSeriesPage"),
);
export const appRoutes = (
  <Route
    element={
      <ProtectedRoute>
        <HomeLayout />
      </ProtectedRoute>
    }
  >
    <Route path={ROUTES.root} element={<Navigate to={ROUTES.home} replace />} />
    <Route path={ROUTES.home} element={<HomePage />} />
    <Route
      path={ROUTES.user}
      element={
        <ProtectedRoute allowedRoles={["admin"]}>
          <UserPage />
        </ProtectedRoute>
      }
    />
    <Route path={ROUTES.settings} element={<SettingsPage />} />
    <Route path={ROUTES.outstanding} element={<OutstandingsPage />} />
    <Route
      path={ROUTES.outstandingPartyDetail}
      element={<OutstandingPartyDetailPage />}
    />
    <Route path={ROUTES.daybook} element={<DaybookPage />} />
    <Route path={ROUTES.convertedOrders} element={<ConvertedOrdersPage />} />
    <Route path={ROUTES.stockRegister} element={<StockRegisterPage />} />
    <Route
      path={ROUTES.CashBankBalancePage}
      element={<CashBankBalancePage />}
    />
    <Route path={ROUTES.createOrder} element={<SaleOrderCreatePage />} />
    <Route path={ROUTES.transactionDetail} element={<TransactionDetailPage />} />
    <Route path={ROUTES.saleOrderDetail} element={<SaleOrderDetailPage />} />
    <Route path={ROUTES.saleOrderEdit} element={<SaleOrderEditPage />} />
    <Route path={ROUTES.salesSelectItems} element={<ProductSelectPage />} />
    <Route path={ROUTES.createReceipt} element={<CreateReceiptPage />} />
    <Route
      path={ROUTES.usersCreate}
      element={
        <ProtectedRoute allowedRoles={["admin"]}>
          <UserCreatePage />
        </ProtectedRoute>
      }
    />
    <Route
      path={ROUTES.usersList}
      element={
        <ProtectedRoute allowedRoles={["admin"]}>
          <UserListPage />
        </ProtectedRoute>
      }
    />
    <Route path={ROUTES.CashInHandListPage} element={<CashInHandListPage />} />
    <Route
      path={ROUTES.BankBalanceListPage}
      element={<BankBalanceListPage />}
    />
    <Route
      path={ROUTES.settingsDataEntry}
      element={<DataEntrySettingsPage />}
    />
    <Route
      path={ROUTES.settingsDataEntryVoucher}
      element={<DataEntryVoucherSettingsPage />}
    />
    <Route
      path={ROUTES.settingsDataEntryOrder}
      element={<DataEntryOrderSettingsPage />}
    />
    <Route
      path={ROUTES.settingsDataEntryReceipt}
      element={<DataEntryReceiptSettingsPage />}
    />
    <Route path={ROUTES.settingsVoucher} element={<VoucherSettingsPage />} />
    <Route
      path={ROUTES.settingsVoucherSeries}
      element={<VoucherSeriesSettingsPage />}
    />
    <Route
      path={ROUTES.settingsVoucherSeriesList}
      element={<VoucherSeriesListPage />}
    />
    <Route
      path={ROUTES.settingsVoucherSeriesCreate}
      element={<CreateVoucherSeriesPage />}
    />
    <Route
      path={ROUTES.settingsPrintConfigurations}
      element={<PrintConfigurationsPage />}
    />
    <Route
      path={ROUTES.settingsIntegrations}
      element={<IntegrationsPage />}
    />
    <Route
      path={ROUTES.settingsPrintConfigurationsSaleOrder}
      element={<PrintConfigDetailPage voucherType="sale_order" />}
    />
    <Route
      path={ROUTES.settingsPrintConfigurationsReceipt}
      element={<PrintConfigDetailPage voucherType="receipt" />}
    />
  </Route>
);
