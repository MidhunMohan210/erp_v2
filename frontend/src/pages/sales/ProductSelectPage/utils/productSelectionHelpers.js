import { recalculateItem } from "@/store/slices/transactionSlice";

const PRODUCT_FILTERS_STORAGE_KEY = "sale-order-product-filters";

export function getStoredProductFilters(cmp_id) {
  if (!cmp_id) return null;
  try {
    const raw = localStorage.getItem(`${PRODUCT_FILTERS_STORAGE_KEY}-${cmp_id}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { search: parsed?.search || "", priceLevel: parsed?.priceLevel || "", brandId: parsed?.brandId || "", categoryId: parsed?.categoryId || "", subcategoryId: parsed?.subcategoryId || "" };
  } catch { return null; }
}

export function persistProductFilters(cmp_id, filters) {
  if (!cmp_id) return;
  try { localStorage.setItem(`${PRODUCT_FILTERS_STORAGE_KEY}-${cmp_id}`, JSON.stringify(filters)); } catch { return; }
}

export const getProductId = (product) => product?._id || product?.id || product?.product_master_id;
export const getMasterOptionId = (option) => option?.value || option?.id || option?._id || option?.brand_id || option?.category_id || option?.subcategory_id;
export const getMasterOptionLabel = (option) => option?.label || option?.brand || option?.category || option?.subcategory || option?.name || "Unnamed";
export const getSubcategoryCategoryId = (subcategory) => subcategory?.categoryId || subcategory?.category_id || subcategory?.category?._id || subcategory?.category?.id || "";

export function getProductTaxRate(productDetail) {
  if (productDetail?.taxRate != null) return Number(productDetail.taxRate) || 0;
  if (productDetail?.igst != null) return Number(productDetail.igst) || 0;
  return (Number(productDetail?.cgst) || 0) + (Number(productDetail?.sgst) || 0);
}
export const getProductBaseUnit = (product) => product?.base_unit || product?.baseUnit || "";
export function getAlternateUnitSnapshot(product) {
  const alternateUnit = product?.alt_unit ?? product?.alternate_unit ?? product?.alternateUnit ?? null;
  const baseDenominator = product?.base_denominator ?? product?.baseDenominator ?? null;
  const altConversion = product?.alt_conversion ?? product?.altConversion ?? null;
  if (!alternateUnit || baseDenominator == null || altConversion == null) return { alternateUnit: null, baseDenominator: null, altConversion: null };
  return { alternateUnit, baseDenominator: Number(baseDenominator), altConversion: Number(altConversion) };
}
export function buildProductDetail(product) {
  const { rate: _ignored, ...detail } = product || {};
  return { ...detail, _id: getProductId(detail), product_name: detail?.product_name || detail?.name || "Untitled Product", hsn: detail?.hsn || detail?.hsn_code || "", base_unit: getProductBaseUnit(detail), baseUnit: getProductBaseUnit(detail), selectedUnit: detail?.selectedUnit ?? detail?.selected_unit ?? getProductBaseUnit(detail), ...getAlternateUnitSnapshot(detail), cgst: Number(detail?.cgst) || 0, sgst: Number(detail?.sgst) || 0, igst: Number(detail?.igst) || 0, cess: Number(detail?.cess) || 0, addl_cess: Number(detail?.addl_cess ?? detail?.addlCess) || 0, taxRate: detail?.taxRate != null ? Number(detail.taxRate) || 0 : getProductTaxRate(detail), priceLevels: Array.isArray(detail?.priceLevels) ? detail.priceLevels : [] };
}
export function getPriceLevelRate(productDetail, priceLevelId) {
  if (!priceLevelId || !Array.isArray(productDetail?.priceLevels)) return null;
  const match = productDetail.priceLevels.find((level) => level?.priceLevel?.toString() === priceLevelId?.toString());
  return match?.priceRate ?? null;
}
export function buildCalcItemFromStaged(stagedItem) {
  if (!stagedItem) return null;
  return { rate: Number(stagedItem.rate) || 0, taxRate: Number(stagedItem.productDetail?.taxRate ?? stagedItem.taxRate ?? 0) || 0, cgst: Number(stagedItem.productDetail?.cgst ?? stagedItem?.cgst ?? 0) || 0, sgst: Number(stagedItem.productDetail?.sgst ?? stagedItem?.sgst ?? 0) || 0, igst: Number(stagedItem.productDetail?.igst ?? stagedItem?.igst ?? 0) || 0, cess: Number(stagedItem.productDetail?.cess ?? stagedItem?.cess ?? 0) || 0, addl_cess: Number(stagedItem.productDetail?.addl_cess ?? stagedItem.productDetail?.addlCess ?? stagedItem?.addl_cess ?? stagedItem?.addlCess ?? 0) || 0, taxType: stagedItem?.taxType || "igst", taxInclusive: Boolean(stagedItem.taxInclusive), discountType: stagedItem.discountType || "percentage", discountPercentage: Number(stagedItem.discountPercentage) || 0, discountAmount: Number(stagedItem.discountAmount) || 0, selectedUnit: stagedItem?.selectedUnit ?? stagedItem?.productDetail?.baseUnit ?? "", actualQty: Number(stagedItem.actualQty != null ? stagedItem.actualQty : stagedItem.quantity) || 0, billedQty: Number(stagedItem.billedQty != null ? stagedItem.billedQty : stagedItem.quantity) || 0, alternateActualQty: stagedItem?.alternateActualQty ?? null, alternateBilledQty: stagedItem?.alternateBilledQty ?? null, alternateUnit: stagedItem?.alternateUnit ?? stagedItem.productDetail?.alternateUnit ?? null, baseDenominator: stagedItem?.baseDenominator ?? stagedItem.productDetail?.baseDenominator ?? null, altConversion: stagedItem?.altConversion ?? stagedItem.productDetail?.altConversion ?? null };
}
export function recalculateStagedItem(stagedItem) {
  const calculated = recalculateItem(buildCalcItemFromStaged(stagedItem));
  return { ...stagedItem, actualQty: calculated.actualQty, billedQty: calculated.billedQty, alternateActualQty: calculated.alternateActualQty, alternateBilledQty: calculated.alternateBilledQty };
}
export function createStagedItemFromTransactionItem(item) {
  const billedQty = Number(item?.billedQty) || 0; const actualQty = Number(item?.actualQty ?? item?.billedQty) || 0;
  const detail = buildProductDetail({ _id: item?.id, product_name: item?.name, hsn: item?.hsn, base_unit: item?.baseUnit, selectedUnit: item?.selectedUnit, alternateUnit: item?.alternateUnit ?? null, baseDenominator: item?.baseDenominator ?? null, altConversion: item?.altConversion ?? null, taxRate: item?.taxRate, cgst: item?.cgst, sgst: item?.sgst, igst: item?.igst, cess: item?.cess, addl_cess: item?.addl_cess ?? item?.addlCess, priceLevels: item?.priceLevels });
  return recalculateStagedItem({ quantity: billedQty, originalQuantity: billedQty, productDetail: detail, selectedUnit: item?.selectedUnit ?? detail?.selectedUnit ?? "", rate: Number(item?.rate) || 0, taxType: item?.taxType || "igst", initialPriceSource: item?.initialPriceSource || "manual", taxInclusive: Boolean(item?.taxInclusive), actualQty, billedQty, alternateUnit: item?.alternateUnit ?? null, baseDenominator: item?.baseDenominator ?? null, altConversion: item?.altConversion ?? null, alternateActualQty: item?.alternateActualQty ?? null, alternateBilledQty: item?.alternateBilledQty ?? null, discountType: item?.discountType || "percentage", discountPercentage: Number(item?.discountPercentage) || 0, discountAmount: Number(item?.discountAmount) || 0, description: item?.description || "", warrantyCardId: item?.warrantyCardId || null, originalSnapshot: { rate: Number(item?.rate) || 0, taxInclusive: Boolean(item?.taxInclusive), actualQty, billedQty, discountType: item?.discountType || "percentage", discountPercentage: Number(item?.discountPercentage) || 0, discountAmount: Number(item?.discountAmount) || 0, description: item?.description || "", warrantyCardId: item?.warrantyCardId || null } });
}
export function buildEditableItem(productId, stagedItem) {
  const detail = buildProductDetail(stagedItem?.productDetail);
  return { id: productId, name: detail?.product_name || "Untitled Product", hsn: detail?.hsn || "", baseUnit: detail?.baseUnit || "", selectedUnit: stagedItem?.selectedUnit ?? detail?.baseUnit ?? "", alternateUnit: stagedItem?.alternateUnit ?? detail?.alternateUnit ?? null, baseDenominator: stagedItem?.baseDenominator ?? detail?.baseDenominator ?? null, altConversion: stagedItem?.altConversion ?? detail?.altConversion ?? null, alternateActualQty: stagedItem?.alternateActualQty ?? null, alternateBilledQty: stagedItem?.alternateBilledQty ?? null, taxRate: getProductTaxRate(detail), cgst: Number(detail?.cgst) || 0, sgst: Number(detail?.sgst) || 0, igst: Number(detail?.igst) || 0, cess: Number(detail?.cess) || 0, addl_cess: Number(detail?.addl_cess ?? detail?.addlCess) || 0, priceLevels: Array.isArray(detail?.priceLevels) ? detail.priceLevels : [], rate: Number(stagedItem?.rate) || 0, taxType: stagedItem?.taxType || "igst", initialPriceSource: stagedItem?.initialPriceSource || "manual", actualQty: Number(stagedItem?.actualQty ?? stagedItem?.quantity) || 0, billedQty: Number(stagedItem?.billedQty ?? stagedItem?.quantity) || 0, taxInclusive: Boolean(stagedItem?.taxInclusive), discountType: stagedItem?.discountType || "percentage", discountPercentage: Number(stagedItem?.discountPercentage) || 0, discountAmount: Number(stagedItem?.discountAmount) || 0, description: stagedItem?.description || "", warrantyCardId: stagedItem?.warrantyCardId || null, basePrice: 0, taxableAmount: 0, taxAmount: 0, totalAmount: 0 };
}
