import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import { formatSaleOrderQuantity } from "@/utils/saleOrderQuantityDisplay";

const PDF_THEME = {
  pageMargin: 14,
  sectionGap: 8,
  dividerColor: [226, 232, 240],
  subtleTextColor: [71, 85, 105],
  bodyTextColor: [31, 41, 55],
  headingTextColor: [15, 23, 42],
  headerFillColor: [245, 247, 250],
};

/**
 * Formats date to `DD-MM-YYYY` for print.
 *
 * @param {string|Date|null|undefined} value
 * @returns {string}
 */
function formatDate(value) {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--";

  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const year = parsed.getFullYear();

  return `${day}-${month}-${year}`;
}

/**
 * Formats number to fixed 2-decimal string.
 *
 * @param {number|string|null|undefined} value
 * @returns {string}
 */
function formatAmount(value) {
  return Number(value || 0).toFixed(2);
}

/**
 * Formats numeric value compactly (no decimal if integer).
 *
 * @param {number|string|null|undefined} value
 * @returns {string}
 */
function formatCompactAmount(value) {
  const numeric = Number(value || 0);
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
}

/**
 * Loads remote image URL as Data URL for jsPDF embedding.
 *
 * @param {string|null|undefined} url
 * @returns {Promise<string|null>}
 */
async function loadImageAsDataUrl(url) {
  if (!url) return null;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const blob = await response.blob();

    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Builds one-line company address from org fields.
 *
 * @param {object} org
 * @returns {string}
 */
function getCompanyAddress(org = {}) {
  return [
    org?.flat,
    org?.road,
    org?.place,
    org?.landmark,
    org?.state,
    org?.country,
    org?.pin,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * Normalizes print-config keys from mixed backend naming styles.
 *
 * @param {object} configurations
 * @returns {object}
 */
function normalizeConfigurations(configurations = {}) {
  return {
    printTitle: configurations?.printTitle || configurations?.print_title || "Sale Order",
    showPrintTitle:
      configurations?.showPrintTitle ??
      configurations?.show_print_title ??
      true,
    showCompanyDetails:
      configurations?.enable_company_details ??
      true,
    showDiscountColumn:
      configurations?.enable_discount_column ??
      true,
    showHsn:
      configurations?.enable_hsn ??
      true,
    showTaxPercentage:
      configurations?.enable_tax_percentage ??
      true,
    showStockWiseTaxAmount:
      configurations?.enable_stock_wise_tax_amount ??
      true,
    showTaxAmount:
      configurations?.enable_tax_amount ??
      true,
    showNetAmount:
      configurations?.enable_net_amount ??
      true,
    showRate:
      configurations?.enable_rate ??
      true,
    showQuantity:
      configurations?.enable_quantity ??
      true,
    showStockWiseAmount:
      configurations?.enable_stock_wise_amount ??
      true,
    showBankDetails:
      configurations?.enable_bank_details ??
      false,
    showTermsAndConditions:
      configurations?.enable_terms_conditions ??
      true,
  };
}

/**
 * Integer-to-words converter (Indian numbering system).
 *
 * @param {number} num
 * @returns {string}
 */
function integerToWords(num) {
  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];

  const toWordsBelowThousand = (value) => {
    if (value === 0) return "";
    if (value < 20) return ones[value];
    if (value < 100) {
      return `${tens[Math.floor(value / 10)]}${
        value % 10 ? ` ${ones[value % 10]}` : ""
      }`;
    }

    return `${ones[Math.floor(value / 100)]} Hundred${
      value % 100 ? ` ${toWordsBelowThousand(value % 100)}` : ""
    }`;
  };

  if (!num) return "Zero";

  const parts = [];
  const crores = Math.floor(num / 10000000);
  const lakhs = Math.floor((num % 10000000) / 100000);
  const thousands = Math.floor((num % 100000) / 1000);
  const hundreds = num % 1000;

  if (crores) parts.push(`${toWordsBelowThousand(crores)} Crore`);
  if (lakhs) parts.push(`${toWordsBelowThousand(lakhs)} Lakh`);
  if (thousands) parts.push(`${toWordsBelowThousand(thousands)} Thousand`);
  if (hundreds) parts.push(toWordsBelowThousand(hundreds));

  return parts.join(" ").trim();
}

/**
 * Converts currency amount to words.
 *
 * @param {number|string} value
 * @returns {string}
 */
function amountToWords(value) {
  const numericValue = Number(value || 0);
  const rupees = Math.floor(numericValue);
  const paise = Math.round((numericValue - rupees) * 100);

  const rupeeWords = `${integerToWords(rupees)} Rupees`;
  const paiseWords = paise ? ` and ${integerToWords(paise)} Paise` : "";

  return `${rupeeWords}${paiseWords} Only`;
}

/**
 * Ensures there is enough vertical space on current page; adds page if needed.
 *
 * @param {jsPDF} doc
 * @param {number} currentY
 * @param {number} requiredHeight
 * @returns {number} Next Y position on current/new page.
 */
function ensureSpace(doc, currentY, requiredHeight) {
  const pageHeight = doc.internal.pageSize.getHeight();

  if (currentY + requiredHeight <= pageHeight - 16) {
    return currentY;
  }

  doc.addPage();
  return 18;
}

/**
 * Shared text style helper.
 *
 * @param {jsPDF} doc
 * @param {{font?: string, weight?: string, size?: number, color?: number[]}} style
 * @returns {void}
 */
function setTextStyle(
  doc,
  { font = "helvetica", weight = "normal", size = 9, color = PDF_THEME.bodyTextColor }
) {
  doc.setFont(font, weight);
  doc.setFontSize(size);
  doc.setTextColor(...color);
}

/**
 * Draws thin horizontal separator line.
 */
function drawDivider(doc, y, pageWidth, margin) {
  doc.setDrawColor(...PDF_THEME.dividerColor);
  doc.setLineWidth(0.2);
  doc.line(margin, y, pageWidth - margin, y);
}

// Item cess/tax helpers support multiple backend field variants.
function getItemCessRate(item = {}) {
  return Number(item?.cess ?? item?.cess_rate ?? item?.cess_percentage ?? 0);
}

function getItemAddlCessRate(item = {}) {
  return Number(
    item?.addl_cess ??
      item?.addlCess ??
      item?.addl_cess_rate ??
      item?.addl_cess_percentage ??
      0
  );
}

function getItemCessAmount(item = {}) {
  return Number(item?.cess_amount ?? 0);
}

function getItemAddlCessAmount(item = {}) {
  return Number(item?.addl_cess_amount ?? item?.addlCessAmount ?? 0);
}

function getTerms(configurations, companySettings, org) {
  return Array.isArray(org?.termsAndConditions)
    ? org.termsAndConditions
    : Array.isArray(companySettings?.dataEntry?.order?.termsAndConditions)
      ? companySettings.dataEntry.order.termsAndConditions
      : Array.isArray(configurations?.termsAndConditions)
        ? configurations.termsAndConditions
        : typeof configurations?.termsAndConditions === "string"
          ? configurations.termsAndConditions
              .split("\n")
              .map((term) => term.trim())
              .filter(Boolean)
          : [];
}

/**
 * Resolves footer bank lines from bank/org data.
 *
 * @param {object} bankDetails
 * @param {object} org
 * @returns {string[]}
 */
function getFooterBankLines(bankDetails, org) {
  const bankInfo = bankDetails || org || {};

  return [
    bankInfo?.partyName && bankInfo?.bank_name
      ? `Bank Name: ${bankInfo.partyName} (${bankInfo.bank_name})`
      : bankInfo?.bank_name
        ? `Bank Name: ${bankInfo.bank_name}`
        : bankInfo?.bankName
          ? `Bank Name: ${bankInfo.bankName}`
          : null,
    bankInfo?.ifsc ? `IFSC Code: ${bankInfo.ifsc}` : null,
    bankInfo?.ac_no
      ? `Account Number: ${bankInfo.ac_no}`
      : bankInfo?.accountNumber
        ? `Account Number: ${bankInfo.accountNumber}`
        : bankInfo?.account
          ? `Account Number: ${bankInfo.account}`
          : null,
    bankInfo?.branch ? `Branch: ${bankInfo.branch}` : null,
  ].filter(Boolean);
}

/**
 * Renders company + voucher header block.
 *
 * @returns {number} next Y position.
 */
function renderHeader({
  doc,
  currentY,
  pageWidth,
  margin,
  org,
  saleOrder,
  title,
  companyLogo,
}) {
  const rightColumnWidth = 54;
  const leftColumnWidth = pageWidth - margin * 2 - rightColumnWidth - 10;
  const logoSize = companyLogo ? 18 : 0;
  const companyContentX = companyLogo ? margin + logoSize + 4 : margin;
  const companyContentWidth = companyLogo
    ? leftColumnWidth - logoSize - 4
    : leftColumnWidth;
  const companyLines = [
    getCompanyAddress(org),
    org?.gstNum ? `GST: ${org.gstNum}` : null,
    org?.pan ? `PAN: ${org.pan}` : null,
    org?.mobile ? `Mobile: ${org.mobile}` : null,
    org?.email ? `Email: ${org.email}` : null,
  ].filter(Boolean);

  const startY = currentY;
  let leftY = currentY;

  if (companyLogo) {
    try {
      doc.addImage(companyLogo, "PNG", margin, startY, logoSize, logoSize);
    } catch {
      try {
        doc.addImage(companyLogo, "JPEG", margin, startY, logoSize, logoSize);
      } catch {
        // ignore
      }
    }
  }

  setTextStyle(doc, {
    weight: "bold",
    size: 13,
    color: PDF_THEME.headingTextColor,
  });
  doc.text(org?.name || "Company", companyContentX, leftY + 4);
  leftY += 9;

  setTextStyle(doc, {
    size: 9.5,
    color: PDF_THEME.subtleTextColor,
  });
  companyLines.forEach((line) => {
    const wrapped = doc.splitTextToSize(line, companyContentWidth);
    doc.text(wrapped, companyContentX, leftY);
    leftY += wrapped.length * 4.5;
  });

  const rightX = pageWidth - margin;
  setTextStyle(doc, {
    weight: "bold",
    size: 16,
    color: PDF_THEME.headingTextColor,
  });
  doc.text(title || "Sale Order", rightX, startY + 5, { align: "right" });

  setTextStyle(doc, {
    weight: "bold",
    size: 10,
    color: PDF_THEME.headingTextColor,
  });
  doc.text(`Order No: ${saleOrder?.voucher_number || "--"}`, rightX, startY + 13, {
    align: "right",
  });

  setTextStyle(doc, {
    size: 9.5,
    color: PDF_THEME.subtleTextColor,
  });
  doc.text(`Date: ${formatDate(saleOrder?.date)}`, rightX, startY + 19, {
    align: "right",
  });

  const nextY = Math.max(leftY, startY + Math.max(logoSize, 22));
  drawDivider(doc, nextY + 2, pageWidth, margin);

  return nextY + PDF_THEME.sectionGap;
}

/**
 * Renders bill-to and ship-to block.
 *
 * @returns {number} next Y position.
 */
function renderPartySection({
  doc,
  currentY,
  pageWidth,
  margin,
  saleOrder,
  partyConfig,
}) {
  const columnGap = 8;
  const boxWidth = (pageWidth - margin * 2 - columnGap) / 2;
  const billToLines = [
    saleOrder?.party_snapshot?.name,
    saleOrder?.party_snapshot?.billing_address,
    saleOrder?.party_snapshot?.gst_no
      ? `GST: ${saleOrder.party_snapshot.gst_no}`
      : null,
    saleOrder?.party_snapshot?.mobile
      ? `Mobile: ${saleOrder.party_snapshot.mobile}`
      : null,
  ].filter(Boolean);
  const shipToLines = [
    saleOrder?.party_snapshot?.name,
    saleOrder?.party_snapshot?.shipping_address ||
      saleOrder?.party_snapshot?.billing_address,
    saleOrder?.party_snapshot?.state
      ? `State: ${saleOrder.party_snapshot.state}`
      : null,
    partyConfig?.shippingNote || null,
  ].filter(Boolean);
  const lineHeight = 4.5;
  const boxHeight = Math.max(billToLines.length, shipToLines.length) * lineHeight + 10;

  setTextStyle(doc, {
    weight: "bold",
    size: 10,
    color: PDF_THEME.headingTextColor,
  });
  doc.text("Bill To", margin, currentY);
  doc.text("Ship To", margin + boxWidth + columnGap, currentY);

  setTextStyle(doc, {
    size: 9.5,
    color: PDF_THEME.bodyTextColor,
  });
  billToLines.forEach((line, index) => {
    const wrapped = doc.splitTextToSize(String(line), boxWidth);
    doc.text(wrapped, margin, currentY + 6 + index * lineHeight);
  });
  shipToLines.forEach((line, index) => {
    const wrapped = doc.splitTextToSize(String(line), boxWidth);
    doc.text(wrapped, margin + boxWidth + columnGap, currentY + 6 + index * lineHeight);
  });

  drawDivider(doc, currentY + boxHeight + 2, pageWidth, margin);

  return currentY + boxHeight + PDF_THEME.sectionGap;
}

/**
 * Returns printable despatch label/value rows.
 *
 * @param {object} saleOrder
 * @returns {Array<[string, any]>}
 */
function getDespatchRows(saleOrder) {
  const despatchDetails = saleOrder?.despatch_details || {};

  return [
    ["Challan No", despatchDetails?.challan_no],
    ["Container No", despatchDetails?.container_no],
    ["Despatch Through", despatchDetails?.despatch_through],
    ["Destination", despatchDetails?.destination],
    ["Vehicle No", despatchDetails?.vehicle_no],
    ["Order No", despatchDetails?.order_no],
    ["Terms Of Pay", despatchDetails?.terms_of_pay],
    ["Terms Of Delivery", despatchDetails?.terms_of_delivery],
  ].filter(([, value]) => value);
}

/**
 * Renders despatch section when at least one despatch field exists.
 *
 * @returns {number} next Y position.
 */
function renderDespatchSection({
  doc,
  currentY,
  pageWidth,
  margin,
  saleOrder,
}) {
  const despatchRows = getDespatchRows(saleOrder);
  if (!despatchRows.length) {
    return currentY;
  }

  const columnGap = 8;
  const columnWidth = (pageWidth - margin * 2 - columnGap) / 2;
  const leftColumn = despatchRows.filter((_, index) => index % 2 === 0);
  const rightColumn = despatchRows.filter((_, index) => index % 2 === 1);
  const headerOffset = 8;
  const getWrappedValueLines = (value) =>
    doc.splitTextToSize(String(value), columnWidth);
  const getColumnHeight = (rows) =>
    rows.reduce(
      (total, [, value]) => total + 4.2 + getWrappedValueLines(value).length * 4.2 + 3.5,
      0
    );
  const estimatedHeight =
    headerOffset + Math.max(getColumnHeight(leftColumn), getColumnHeight(rightColumn)) + 2;

  let nextY = ensureSpace(doc, currentY, estimatedHeight + 4);

  setTextStyle(doc, {
    weight: "bold",
    size: 10,
    color: PDF_THEME.headingTextColor,
  });
  doc.text("Despatch Details", margin, nextY);

  const renderColumn = (rows, startX) => {
    let rowY = nextY + headerOffset;

    rows.forEach(([label, value]) => {
      const lines = getWrappedValueLines(value);

      setTextStyle(doc, {
        size: 8.5,
        color: PDF_THEME.subtleTextColor,
      });
      doc.text(label, startX, rowY);

      setTextStyle(doc, {
        size: 9.2,
        color: PDF_THEME.bodyTextColor,
      });
      doc.text(lines, startX, rowY + 4.2);

      rowY += 4.2 + lines.length * 4.2 + 3.5;
    });
  };

  renderColumn(leftColumn, margin);
  renderColumn(rightColumn, margin + columnWidth + columnGap);

  drawDivider(doc, nextY + estimatedHeight, pageWidth, margin);

  return nextY + estimatedHeight + PDF_THEME.sectionGap;
}

/**
 * Builds dynamic item table columns based on print configuration flags.
 *
 * @param {object} resolvedConfigurations
 * @returns {Array<object>}
 */
function buildItemColumns(resolvedConfigurations) {
  return [
    {
      key: "no",
      header: "No",
      value: (_, index) => index + 1,
      style: { cellWidth: 7, halign: "center" },
    },
    {
      key: "items",
      header: "Item",
      value: (item) => item?.item_name || "--",
      style: { cellWidth: 34, halign: "left" },
    },
    resolvedConfigurations.showHsn
      ? {
          key: "hsn",
          header: "HSN",
          value: (item) => item?.hsn || "--",
          style: { cellWidth: 14, halign: "center" },
        }
      : null,
    resolvedConfigurations.showTaxPercentage
      ? {
          key: "tax_rate",
          header: "Tax %",
          value: (item) => formatCompactAmount(item?.tax_rate),
          style: { cellWidth: 10, halign: "right" },
        }
      : null,
    resolvedConfigurations.showTaxPercentage
      ? {
          key: "cess_rate",
          header: "Cess %",
          value: (item) => formatCompactAmount(getItemCessRate(item)),
          style: { cellWidth: 10, halign: "right" },
        }
      : null,
    resolvedConfigurations.showTaxPercentage
      ? {
          key: "addl_cess_rate",
          header: "Addl Cess",
          value: (item) => formatCompactAmount(getItemAddlCessRate(item)),
          style: { cellWidth: 11, halign: "right" },
        }
      : null,
    resolvedConfigurations.showQuantity
      ? {
          key: "qty",
          header: "Qty",
          value: (item) =>
            formatSaleOrderQuantity({
              qty: item?.billed_qty,
              unit: item?.unit,
              alternateQty: item?.alternate_billed_qty,
              alternateUnit: item?.alternate_unit,
            }),
          style: { cellWidth: 11, halign: "center" },
        }
      : null,
    resolvedConfigurations.showRate
      ? {
          key: "rate",
          header: "Rate",
          value: (item) => formatCompactAmount(item?.rate),
          style: { cellWidth: 13, halign: "right" },
        }
      : null,
    resolvedConfigurations.showDiscountColumn
      ? {
          key: "discount",
          header: "Disc",
          value: (item) => formatCompactAmount(item?.discount_amount),
          style: { cellWidth: 11, halign: "right" },
        }
      : null,
    resolvedConfigurations.showStockWiseAmount
      ? {
          key: "amount",
          header: "Amt",
          value: (item) =>
            formatCompactAmount(item?.taxable_amount ?? item?.base_price),
          style: { cellWidth: 13, halign: "right" },
        }
      : null,
    resolvedConfigurations.showStockWiseTaxAmount
      ? {
          key: "tax_amount",
          header: "Tax Amt",
          value: (item) => formatCompactAmount(item?.tax_amount || 0),
          style: { cellWidth: 12, halign: "right" },
        }
      : null,
    resolvedConfigurations.showStockWiseTaxAmount
      ? {
          key: "cess_amount",
          header: "Cess Amt",
          value: (item) => formatCompactAmount(getItemCessAmount(item)),
          style: { cellWidth: 12, halign: "right" },
        }
      : null,
    resolvedConfigurations.showStockWiseTaxAmount
      ? {
          key: "addl_cess_amount",
          header: "Addl Amt",
          value: (item) => formatCompactAmount(getItemAddlCessAmount(item)),
          style: { cellWidth: 12, halign: "right" },
        }
      : null,
    resolvedConfigurations.showNetAmount
      ? {
          key: "net_amount",
          header: "Net Amt",
          value: (item) => formatCompactAmount(item?.total_amount),
          style: { cellWidth: 12, halign: "right" },
        }
      : null,
  ].filter(Boolean);
}

/**
 * Renders items table via jspdf-autotable.
 *
 * @returns {number} next Y position.
 */
function renderItemsTable({
  doc,
  currentY,
  pageWidth,
  margin,
  saleOrder,
  resolvedConfigurations,
}) {
  const itemColumns = buildItemColumns(resolvedConfigurations);
  const availableTableWidth = pageWidth - margin * 2;
  const totalBaseWidth = itemColumns.reduce(
    (sum, column) => sum + (Number(column?.style?.cellWidth) || 0),
    0
  );
  const widthScale = totalBaseWidth > 0 ? availableTableWidth / totalBaseWidth : 1;

  const columnStyles = itemColumns.reduce((accumulator, column, index) => {
    accumulator[index] = {
      ...column.style,
      cellWidth: (Number(column?.style?.cellWidth) || 0) * widthScale,
    };
    return accumulator;
  }, {});

  const footerRow = itemColumns.map((column) => {
    switch (column.key) {
      case "items":
        return "Subtotal";
      case "amount":
        return formatCompactAmount(
          saleOrder?.totals?.taxable_amount ?? saleOrder?.totals?.sub_total
        );
      case "tax_amount":
        return formatCompactAmount(saleOrder?.totals?.total_tax_amount);
      case "cess_amount":
        return formatCompactAmount(saleOrder?.totals?.total_cess_amt);
      case "addl_cess_amount":
        return formatCompactAmount(saleOrder?.totals?.total_addl_cess_amt);
      case "net_amount":
        return formatCompactAmount(saleOrder?.totals?.final_amount);
      default:
        return "";
    }
  });

  autoTable(doc, {
    startY: currentY,
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 7.2,
      cellPadding: 1.6,
      textColor: PDF_THEME.bodyTextColor,
      valign: "top",
      lineColor: PDF_THEME.dividerColor,
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: PDF_THEME.headerFillColor,
      textColor: PDF_THEME.headingTextColor,
      fontStyle: "bold",
      halign: "center",
    },
    bodyStyles: {
      textColor: PDF_THEME.bodyTextColor,
    },
    footStyles: {
      fillColor: [241, 245, 249],
      textColor: PDF_THEME.headingTextColor,
      fontStyle: "bold",
      halign: "right",
    },
    columnStyles,
    head: [itemColumns.map((column) => column.header)],
    body: (saleOrder?.items || []).map((item, index) =>
      itemColumns.map((column) => column.value(item, index))
    ),
    foot: [footerRow],
    showFoot: "lastPage",
  });

  return doc.lastAutoTable?.finalY + PDF_THEME.sectionGap || currentY + PDF_THEME.sectionGap;
}

/**
 * Builds summary-row label/value pairs for totals panel.
 *
 * @param {object} saleOrder
 * @param {object} resolvedConfigurations
 * @returns {Array<[string, string]>}
 */
function buildSummaryRows(saleOrder, resolvedConfigurations) {
  const summaryRows = [["Subtotal", formatAmount(saleOrder?.totals?.sub_total)]];

  if (resolvedConfigurations.showTaxAmount) {
    summaryRows.push(["Total Tax", formatAmount(saleOrder?.totals?.total_tax_amount)]);
    if (Number(saleOrder?.totals?.total_cess_amt || 0) > 0) {
      summaryRows.push(["Cess", formatAmount(saleOrder?.totals?.total_cess_amt)]);
    }
    if (Number(saleOrder?.totals?.total_addl_cess_amt || 0) > 0) {
      summaryRows.push([
        "Additional Cess",
        formatAmount(saleOrder?.totals?.total_addl_cess_amt),
      ]);
    }
    if (Number(saleOrder?.totals?.total_igst_amt || 0) > 0) {
      summaryRows.push(["IGST", formatAmount(saleOrder?.totals?.total_igst_amt)]);
    }
    if (Number(saleOrder?.totals?.total_cgst_amt || 0) > 0) {
      summaryRows.push(["CGST", formatAmount(saleOrder?.totals?.total_cgst_amt)]);
    }
    if (Number(saleOrder?.totals?.total_sgst_amt || 0) > 0) {
      summaryRows.push(["SGST", formatAmount(saleOrder?.totals?.total_sgst_amt)]);
    }
  }

  if (resolvedConfigurations.showNetAmount) {
    summaryRows.push(["Grand Total", formatAmount(saleOrder?.totals?.final_amount)]);
  }

  return summaryRows;
}

/**
 * Renders totals + amount-in-words block.
 *
 * @returns {number} next Y position.
 */
function renderTotalsSection({
  doc,
  currentY,
  pageWidth,
  margin,
  saleOrder,
  resolvedConfigurations,
}) {
  const summaryRows = buildSummaryRows(saleOrder, resolvedConfigurations);
  const blockWidth = 58;
  const startX = pageWidth - margin - blockWidth;
  const dividerY = currentY + 1;
  const rowsStartY = currentY + 8;

  drawDivider(doc, dividerY, pageWidth, margin);

  summaryRows.forEach(([label, value], index) => {
    const rowY = rowsStartY + index * 5.5;
    const isGrandTotal = label === "Grand Total";

    setTextStyle(doc, {
      weight: isGrandTotal ? "bold" : "normal",
      size: isGrandTotal ? 11 : 9.5,
      color: isGrandTotal ? PDF_THEME.headingTextColor : PDF_THEME.subtleTextColor,
    });
    doc.text(label, startX, rowY);

    setTextStyle(doc, {
      weight: isGrandTotal ? "bold" : "normal",
      size: isGrandTotal ? 11 : 9.5,
      color: PDF_THEME.headingTextColor,
    });
    doc.text(value, pageWidth - margin, rowY, { align: "right" });
  });

  let nextY = rowsStartY + summaryRows.length * 5.5 + PDF_THEME.sectionGap;

  if (resolvedConfigurations.showNetAmount) {
    nextY = ensureSpace(doc, nextY, 16);
    setTextStyle(doc, {
      weight: "bold",
      size: 9,
      color: PDF_THEME.headingTextColor,
    });
    const amountInWords = `Net Amount (in words): ${amountToWords(
      saleOrder?.totals?.final_amount
    ).toUpperCase()}`;
    const lines = doc.splitTextToSize(amountInWords, 92);
    doc.text(lines, pageWidth - margin, nextY, { align: "right" });
    nextY += lines.length * 4.5 + 4;
  }

  return nextY;
}

/**
 * Renders terms section.
 *
 * @returns {number} next Y position.
 */
function renderTermsSection({
  doc,
  currentY,
  pageWidth,
  margin,
  terms,
  resolvedConfigurations,
}) {
  if (!resolvedConfigurations.showTermsAndConditions || !terms.length) {
    return currentY;
  }

  const estimatedHeight =
    10 +
    terms.reduce((total, term, index) => {
      const lines = doc.splitTextToSize(`${index + 1}. ${term}`, pageWidth - margin * 2);
      return total + lines.length * 4.8;
    }, 0);

  let nextY = ensureSpace(doc, currentY + 2, estimatedHeight + 18);
  drawDivider(doc, nextY - 2, pageWidth, margin);

  setTextStyle(doc, {
    weight: "bold",
    size: 10,
    color: PDF_THEME.headingTextColor,
  });
  doc.text("Terms & Conditions", margin, nextY + 3);
  nextY += 8;

  setTextStyle(doc, {
    size: 8.25,
    color: PDF_THEME.subtleTextColor,
  });
  terms.forEach((term, index) => {
    const lines = doc.splitTextToSize(`${index + 1}. ${term}`, pageWidth - margin * 2);
    doc.text(lines, margin, nextY);
    nextY += lines.length * 4.8;
  });

  return nextY + PDF_THEME.sectionGap;
}

/**
 * Renders footer with optional bank details and signature area.
 *
 * @returns {void}
 */
function renderFooter({
  doc,
  currentY,
  pageWidth,
  pageHeight,
  margin,
  org,
  footerBankLines,
  resolvedConfigurations,
}) {
  const shouldShowBankDetails =
    resolvedConfigurations.showBankDetails && footerBankLines.length > 0;
  const shouldShowFooter = shouldShowBankDetails || Boolean(org?.name);

  if (!shouldShowFooter) {
    return;
  }

  const footerTopY = Math.max(currentY + 10, pageHeight - 34);
  drawDivider(doc, footerTopY - 5, pageWidth, margin);

  if (shouldShowBankDetails) {
    setTextStyle(doc, {
      size: 9.2,
      weight: "bold",
      color: PDF_THEME.subtleTextColor,
    });
    footerBankLines.forEach((line, index) => {
      doc.text(line, margin, footerTopY + index * 5);
    });
  }

  const rightX = pageWidth - margin;
  setTextStyle(doc, {
    weight: "bold",
    size: 10,
    color: PDF_THEME.headingTextColor,
  });
  doc.text(org?.name || "Company", rightX, footerTopY + 4, { align: "right" });
  doc.text("Authorized Signatory", rightX, footerTopY + 24, { align: "right" });
}

/**
 * Generates and opens downloadable Sale Order PDF.
 *
 * @param {{
 *   saleOrder: object,
 *   org: object,
 *   configurations?: object,
 *   bankDetails?: object,
 *   companySettings?: object,
 *   partyConfig?: object
 * }} payload
 * @returns {Promise<void>}
 */
export async function generateSaleOrderPdf({
  saleOrder,
  org,
  configurations,
  bankDetails,
  companySettings,
  partyConfig,
}) {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });
  const resolvedConfigurations = normalizeConfigurations(configurations);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = PDF_THEME.pageMargin;
  let currentY = PDF_THEME.pageMargin;
  const companyLogo = await loadImageAsDataUrl(org?.logo);

  currentY = renderHeader({
    doc,
    currentY,
    pageWidth,
    margin,
    org,
    saleOrder,
    title:
      resolvedConfigurations.showPrintTitle && resolvedConfigurations.printTitle
        ? resolvedConfigurations.printTitle
        : "Sale Order",
    companyLogo,
  });

  currentY = renderPartySection({
    doc,
    currentY,
    pageWidth,
    margin,
    saleOrder,
    partyConfig,
  });

  currentY = renderDespatchSection({
    doc,
    currentY,
    pageWidth,
    margin,
    saleOrder,
  });

  currentY = renderItemsTable({
    doc,
    currentY,
    pageWidth,
    margin,
    saleOrder,
    resolvedConfigurations,
  });

  currentY = renderTotalsSection({
    doc,
    currentY,
    pageWidth,
    margin,
    saleOrder,
    resolvedConfigurations,
  });

  const terms = getTerms(configurations, companySettings, org);
  currentY = renderTermsSection({
    doc,
    currentY,
    pageWidth,
    margin,
    terms,
    resolvedConfigurations,
  });

  const footerBankLines = getFooterBankLines(bankDetails, org);
  renderFooter({
    doc,
    currentY,
    pageWidth,
    pageHeight,
    margin,
    org,
    footerBankLines,
    resolvedConfigurations,
  });

  const fileName = `SaleOrder-${saleOrder?.voucher_number || "document"}.pdf`;
  const blobUrl = doc.output("bloburl");
  window.open(blobUrl, "_blank");
  doc.save(fileName);
}
