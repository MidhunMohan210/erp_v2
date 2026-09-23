export const PRINT_CONFIG_DEFAULTS = {
  sale_order: {
    print_title: "Sale Order",
    show_print_title: true,
    enable_company_details: true,
    enable_discount_column: true,
    enable_discount_amount: true,
    enable_hsn: true,
    enable_tax_percentage: true,
    enable_incl_tax_rate: false,
    enable_tax_analysis: false,
    enable_stock_wise_tax_amount: true,
    enable_tax_amount: true,
    enable_terms_conditions: false,
    enable_bank_details: true,
    enable_rate: true,
    enable_quantity: true,
    enable_stock_wise_amount: true,
    enable_net_amount: true,
  },
  // Sale uses the same supported controls as Sale Order, but is stored under
  // its own voucher_type so changing one print layout never changes the other.
  sale: {
    print_title: "Sale",
    show_print_title: true,
    enable_company_details: true,
    enable_discount_column: true,
    enable_discount_amount: true,
    enable_hsn: true,
    enable_tax_percentage: true,
    enable_incl_tax_rate: false,
    enable_tax_analysis: false,
    enable_stock_wise_tax_amount: true,
    enable_tax_amount: true,
    enable_terms_conditions: false,
    enable_bank_details: true,
    enable_rate: true,
    enable_quantity: true,
    enable_stock_wise_amount: true,
    enable_net_amount: true,
  },
  receipt: {
    print_title: "Receipt",
    show_print_title: true,
    enable_company_details: true,
    enable_party_details: true,
    enable_payment_mode: true,
    enable_received_amount: true,
    enable_balance_due: true,
    enable_narration: true,
    enable_terms_conditions: false,
    enable_bank_details: false,
    enable_authorized_signature: true,
  },
};

export const VALID_PRINT_VOUCHER_TYPES = Object.keys(PRINT_CONFIG_DEFAULTS);

export const isValidPrintVoucherType = (voucher_type) =>
  VALID_PRINT_VOUCHER_TYPES.includes(voucher_type);

export const getDefaultConfig = (voucher_type) => {
  const config = PRINT_CONFIG_DEFAULTS[voucher_type];
  return config ? { ...config } : null;
};

export const getDefaultPrintConfigDocuments = (cmp_id) =>
  VALID_PRINT_VOUCHER_TYPES.map((voucher_type) => ({
    cmp_id,
    voucher_type,
    config: getDefaultConfig(voucher_type),
  }));
