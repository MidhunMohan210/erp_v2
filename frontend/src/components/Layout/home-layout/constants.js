import {
  Home,
  Settings,
  Building2,
  CircleUserRound,
} from "lucide-react";

import { ROUTES } from "@/routes/paths";

export const mobileTabs = [
  { id: "home", label: "Home", icon: Home, to: ROUTES.home },
  { id: "company", label: "Company", icon: Building2, to: ROUTES.mastersCompany },
  { id: "users", label: "Users", icon: CircleUserRound, to: ROUTES.mastersUsers },
  { id: "settings", label: "Settings", icon: Settings, to: ROUTES.settings },
];

export const routeTitleMap = {
  [ROUTES.home]: "Home",
  [ROUTES.mastersCompany]: "Company",
  [ROUTES.mastersCompanyRegister]: "Company",
  [ROUTES.mastersUsers]: "Users",
  [ROUTES.mastersUserRegister]: "User",
  [ROUTES.settings]: "Settings",
  [ROUTES.settingsIntegrations]: "Integrations",
  [ROUTES.mastersCustomers]: "Customers",
  [ROUTES.mastersProducts]: "Products",
  [ROUTES.mastersPartyList]: "Parties",
  [ROUTES.mastersPartyRegister]: "Party",
  [ROUTES.outstanding]: "Outstandings",
  [ROUTES.daybook]: "Daybook",
  [ROUTES.stockRegister]: "Stock Register",
  [ROUTES.cashBank]: "Cash / Bank",
  [ROUTES.createOrder]: "Create Order",
  [ROUTES.transactionDetail]: "Transaction",
  [ROUTES.saleOrderDetail]: "Sale Order",
  [ROUTES.salesSelectItems]: "Select Items",
  [ROUTES.createReceipt]: "Create Receipt",
};

export const DEFAULT_MOBILE_HEADER_OPTIONS = {
  showMenuDots: true,
  onMenuClick: undefined,
  menuItems: [],
  actionButtons: [],
  search: null,
};
