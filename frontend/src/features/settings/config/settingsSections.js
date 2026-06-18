import { MdDataSaverOff } from "react-icons/md";
import { FiFileText } from "react-icons/fi";
import { SiSteelseries } from "react-icons/si";
import { TbFileInvoice } from "react-icons/tb";
import { LuPrinter } from "react-icons/lu";
import { LuPlug } from "react-icons/lu";
import { ScrollText, ReceiptText } from "lucide-react";

import { ROUTES } from "@/routes/paths";

export const settingsRootItems = [
  {
    id: "settings-data-entry",
    title: "DATA ENTRY",
    description: "Data entry settings",
    icon: MdDataSaverOff,
    action: {
      type: "route",
      to: ROUTES.settingsDataEntry,
    },
    active: true,
  },
  {
    id: "settings-print-configurations",
    title: "PRINT CONFIGURATIONS",
    description: "Configure print settings for your vouchers",
    icon: LuPrinter,
    action: {
      type: "route",
      to: ROUTES.settingsPrintConfigurations,
    },
    active: true,
  },
  {
    id: "settings-integrations",
    title: "INTEGRATIONS",
    description: "Manage third-party integrations",
    icon: LuPlug,
    action: {
      type: "route",
      to: ROUTES.settingsIntegrations,
    },
    active: true,
  },
];

export const dataEntrySettingsItems = [
  {
    id: "data-entry-voucher-settings",
    title: "Voucher",
    description: "Manage voucher series and default bank account settings",
    icon: FiFileText,
    action: {
      type: "route",
      to: ROUTES.settingsDataEntryVoucher,
    },
    active: true,
  },
  {
    id: "data-entry-order-settings",
    title: "Order",
    description: "Manage terms and conditions for order entry",
    icon: ScrollText,
    action: {
      type: "route",
      to: ROUTES.settingsDataEntryOrder,
    },
    active: true,
  },
  {
    id: "data-entry-receipt-settings",
    title: "Receipt",
    description: "Configure receipt-related data entry settings",
    icon: ReceiptText,
    action: {
      type: "route",
      to: ROUTES.settingsDataEntryReceipt,
    },
    active: true,
  },
];

export const voucherSettingsItems = [
  {
    id: "voucher-series",
    title: "Voucher Series",
    description: "Configure series for your vouchers",
    icon: SiSteelseries,
    action: {
      type: "route",
      to: ROUTES.settingsVoucherSeries,
    },
    active: true,
  },
  {
    id: "voucher-print-configurations",
    title: "Print Configurations",
    description: "Configure print layouts for your vouchers",
    icon: LuPrinter,
    action: {
      type: "route",
      to: ROUTES.settingsPrintConfigurations,
    },
    active: true,
  },
];

export const getVoucherSeriesSettingsItems = () => [
  {
    id: "voucher-series-sale-order",
    title: "Sale Order",
    description: "Configure voucher series for Sale Orders",
    icon: TbFileInvoice,
    action: {
      type: "route",
      to: ROUTES.settingsVoucherSeriesList,
      search: "?voucherType=saleOrder",
      state: { from: "saleOrder" },
    },
    active: true,
  },
  {
    id: "voucher-series-receipt",
    title: "Receipt",
    description: "Configure voucher series for Receipt",
    icon: TbFileInvoice,
    action: {
      type: "route",
      to: ROUTES.settingsVoucherSeriesList,
      search: "?voucherType=receipt",
      state: { from: "receipt" },
    },
    active: true,
  },
];

export const getPrintConfigurationItems = () => [
  {
    id: "print-config-sale-order",
    title: "Sale Order",
    description: "Configure print settings for sale orders",
    icon: TbFileInvoice,
    action: {
      type: "route",
      to: ROUTES.settingsPrintConfigurationsSaleOrder,
    },
    active: true,
  },
  // {
  //   id: "print-config-receipt",
  //   title: "Receipt",
  //   description: "Configure print settings for receipts",
  //   icon: TbFileInvoice,
  //   action: {
  //     type: "route",
  //     to: ROUTES.settingsPrintConfigurationsReceipt,
  //   },
  //   active: true,
  // },
];
