import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Barcode,
  ChevronDown,
  Package,
  Pencil,
  Search,
  X,
  SlidersHorizontal,
} from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";
import { useLocation, useNavigate } from "react-router-dom";

import { getProductById, productService } from "@/api/services/product.service";
import { useMobileHeader } from "@/components/Layout/HomeLayout";
import ItemEditSheet from "@/components/sales/ItemEditSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  useBrandsQuery,
  useCategoriesQuery,
  useInfiniteProductListQuery,
  usePriceLevelsQuery,
  useSubcategoriesQuery,
} from "@/hooks/queries/productQueries";
import { ROUTES } from "@/routes/paths";
import {
  addItemsFromSelection,
  recalculateItem,
  setPriceLevel,
  setPriceLevelObject,
  updateItem,
} from "@/store/slices/transactionSlice";
import {
  changeProductListQuantity,
} from "@/utils/saleOrderProductListUnit";
import ExtractedProductRow from "./ProductSelectPage/components/ProductRow";
import ExtractedProductFilterSheet from "./ProductSelectPage/components/ProductFilterSheet";

const PAGE_SIZE = 20;
const PRODUCT_FILTERS_STORAGE_KEY = "sale-order-product-filters";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Reads previously saved product filter values for a specific company.
 *
 * Why this exists:
 * - Filters must persist when user leaves and returns to this page.
 * - Filters are company-specific, so key includes `cmp_id`.
 *
 * @param {string} cmp_id - Active company id.
 * @returns {{
 *   search: string,
 *   priceLevel: string,
 *   brandId: string,
 *   categoryId: string,
 *   subcategoryId: string,
 * } | null}
 * Returns normalized filter object or `null` when absent/invalid.
 */
function getStoredProductFilters(cmp_id) {
  // Company-scoped localStorage keeps filter state isolated between companies.
  if (!cmp_id) return null;
  try {
    const raw = localStorage.getItem(`${PRODUCT_FILTERS_STORAGE_KEY}-${cmp_id}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      search: parsed?.search || "",
      priceLevel: parsed?.priceLevel || "",
      brandId: parsed?.brandId || "",
      categoryId: parsed?.categoryId || "",
      subcategoryId: parsed?.subcategoryId || "",
    };
  } catch {
    return null;
  }
}

/**
 * Persists filter state to localStorage for the active company.
 *
 * @param {string} cmp_id - Active company id.
 * @param {{
 *   search: string,
 *   priceLevel: string,
 *   brandId: string,
 *   categoryId: string,
 *   subcategoryId: string,
 * }} filters - Current filter selection.
 * @returns {void}
 */
function persistProductFilters(cmp_id, filters) {
  if (!cmp_id) return;
  try {
    localStorage.setItem(
      `${PRODUCT_FILTERS_STORAGE_KEY}-${cmp_id}`,
      JSON.stringify(filters),
    );
  } catch {
    return;
  }
}

/**
 * Normalizes product identifier from mixed API shapes.
 *
 * @param {object} product - Product record from list/detail endpoint.
 * @returns {string|undefined} Canonical product id when available.
 */
function getProductId(product) {
  return product?._id || product?.id || product?.product_master_id;
}





/**
 * Resolves total tax rate for a product.
 *
 * Expected precedence:
 * 1) explicit `taxRate`
 * 2) `igst`
 * 3) `cgst + sgst`
 *
 * @param {object} productDetail
 * @returns {number} Tax rate percentage.
 */
function getProductTaxRate(productDetail) {
  // Prefer explicit taxRate if backend already provides it;
  // otherwise derive from IGST or CGST+SGST fields.
  if (productDetail?.taxRate != null) return Number(productDetail.taxRate) || 0;
  if (productDetail?.igst != null) return Number(productDetail.igst) || 0;
  return (Number(productDetail?.cgst) || 0) + (Number(productDetail?.sgst) || 0);
}

function getProductBaseUnit(product) {
  return product?.base_unit || product?.baseUnit || "";
}

function getAlternateUnitSnapshot(product) {
  const alternateUnit =
    product?.alt_unit ?? product?.alternate_unit ?? product?.alternateUnit ?? null;
  const baseDenominator = product?.base_denominator ?? product?.baseDenominator ?? null;
  const altConversion = product?.alt_conversion ?? product?.altConversion ?? null;


  /// if any of the alternate unit fields are missing, return nulls for all

  if (!alternateUnit || baseDenominator == null || altConversion == null) {
    return {
      alternateUnit: null,
      baseDenominator: null,
      altConversion: null,
    };
  }

  return {
    alternateUnit,
    baseDenominator: Number(baseDenominator),
    altConversion: Number(altConversion),
  };
}

/**
 * Converts product data from any source into a normalized "product detail" shape
 * used by staging, rate lookups, and item editing.
 *
 * @param {object} product - List row, detail response, or staged sub-object.
 * @returns {{
 *   _id: string|undefined,
 *   product_name: string,
 *   hsn: string,
 *   baseUnit: string,
 *   selectedUnit: string,
 *   cgst: number,
 *   sgst: number,
 *   igst: number,
 *   cess: number,
 *   addl_cess: number,
 *   taxRate: number,
 *   priceLevels: Array
 * } & object}
 */
function buildProductDetail(product) {
  // Normalize product shape from different endpoints/list responses into one
  // local format used by staged-item calculations and edit sheet.
  const { rate: _ignored, ...detail } = product || {};
  return {
    ...detail,
    _id: getProductId(detail),
    product_name: detail?.product_name || detail?.name || "Untitled Product",
    hsn: detail?.hsn || detail?.hsn_code || "",
    base_unit: getProductBaseUnit(detail),
    baseUnit: getProductBaseUnit(detail),
    selectedUnit:
      detail?.selectedUnit ?? detail?.selected_unit ?? getProductBaseUnit(detail),
    ...getAlternateUnitSnapshot(detail),
    cgst: Number(detail?.cgst) || 0,
    sgst: Number(detail?.sgst) || 0,
    igst: Number(detail?.igst) || 0,
    cess: Number(detail?.cess) || 0,
    addl_cess: Number(detail?.addl_cess ?? detail?.addlCess) || 0,
    taxRate:
      detail?.taxRate != null ? Number(detail.taxRate) || 0 : getProductTaxRate(detail),
    priceLevels: Array.isArray(detail?.priceLevels) ? detail.priceLevels : [],
  };
}

/**
 * Finds the configured rate for a product under a selected price level.
 *
 * @param {{ priceLevels?: Array<{priceLevel?: string, priceRate?: number}> }} productDetail
 * @param {string} priceLevelId
 * @returns {number|null} Rate when match exists, else `null`.
 */
function getPriceLevelRate(productDetail, priceLevelId) {
  // Price-level rates are stored as `{ priceLevel, priceRate }` array.
  if (!priceLevelId || !Array.isArray(productDetail?.priceLevels)) return null;
  const match = productDetail.priceLevels.find(
    (l) => l?.priceLevel?.toString() === priceLevelId?.toString(),
  );
  return match?.priceRate ?? null;
}

/**
 * Converts staged item state into a minimal input object expected by
 * `recalculateItem` for live row-total preview in product list rows.
 *
 * @param {object} stagedItem
 * @returns {object|null} Calculation-ready item object or `null`.
 */
function buildCalcItemFromStaged(stagedItem) {
  if (!stagedItem) return null;
  return {
    rate: Number(stagedItem.rate) || 0,
    taxRate: Number(stagedItem.productDetail?.taxRate ?? stagedItem.taxRate ?? 0) || 0,
    cgst: Number(stagedItem.productDetail?.cgst ?? stagedItem?.cgst ?? 0) || 0,
    sgst: Number(stagedItem.productDetail?.sgst ?? stagedItem?.sgst ?? 0) || 0,
    igst: Number(stagedItem.productDetail?.igst ?? stagedItem?.igst ?? 0) || 0,
    cess: Number(stagedItem.productDetail?.cess ?? stagedItem?.cess ?? 0) || 0,
    addl_cess:
      Number(
        stagedItem.productDetail?.addl_cess ??
          stagedItem.productDetail?.addlCess ??
          stagedItem?.addl_cess ??
          stagedItem?.addlCess ??
          0,
      ) || 0,
    taxType: stagedItem?.taxType || "igst",
    taxInclusive: Boolean(stagedItem.taxInclusive),
    discountType: stagedItem.discountType || "percentage",
    discountPercentage: Number(stagedItem.discountPercentage) || 0,
    discountAmount: Number(stagedItem.discountAmount) || 0,
    selectedUnit:
      stagedItem?.selectedUnit ?? stagedItem?.productDetail?.baseUnit ?? "",
    actualQty:
      Number(stagedItem.actualQty != null ? stagedItem.actualQty : stagedItem.quantity) ||
      0,
    billedQty:
      Number(stagedItem.billedQty != null ? stagedItem.billedQty : stagedItem.quantity) ||
      0,
    alternateActualQty: stagedItem?.alternateActualQty ?? null,
    alternateBilledQty: stagedItem?.alternateBilledQty ?? null,
    alternateUnit: stagedItem?.alternateUnit ?? stagedItem.productDetail?.alternateUnit ?? null,
    baseDenominator:
      stagedItem?.baseDenominator ?? stagedItem.productDetail?.baseDenominator ?? null,
    altConversion:
      stagedItem?.altConversion ?? stagedItem.productDetail?.altConversion ?? null,
  };
}

function recalculateStagedItem(stagedItem) {
  const calculated = recalculateItem(buildCalcItemFromStaged(stagedItem));
  return {
    ...stagedItem,
    actualQty: calculated.actualQty,
    billedQty: calculated.billedQty,
    alternateActualQty: calculated.alternateActualQty,
    alternateBilledQty: calculated.alternateBilledQty,
  };
}

/**
 * Converts an already-added transaction item into local "staged item" shape.
 * Used when user re-enters item selector while editing an existing draft.
 *
 * @param {object} item - Transaction slice item shape.
 * @returns {{
 *   quantity: number,
 *   originalQuantity: number,
 *   productDetail: object,
 *   rate: number,
 *   taxType: string,
 *   initialPriceSource: string,
 *   taxInclusive: boolean,
 *   actualQty: number,
 *   billedQty: number,
 *   discountType: string,
 *   discountPercentage: number,
 *   discountAmount: number,
 *   description: string,
 *   warrantyCardId: string|null,
 *   originalSnapshot: object
 * }}
 */
function createStagedItemFromTransactionItem(item) {
  const billedQty = Number(item?.billedQty) || 0;
  const actualQty = Number(item?.actualQty ?? item?.billedQty) || 0;
  const detail = buildProductDetail({
    _id: item?.id,
    product_name: item?.name,
    hsn: item?.hsn,
    base_unit: item?.baseUnit,
    selectedUnit: item?.selectedUnit,
    alternateUnit: item?.alternateUnit ?? null,
    baseDenominator: item?.baseDenominator ?? null,
    altConversion: item?.altConversion ?? null,
    taxRate: item?.taxRate,
    cgst: item?.cgst,
    sgst: item?.sgst,
    igst: item?.igst,
    cess: item?.cess,
    addl_cess: item?.addl_cess ?? item?.addlCess,
    priceLevels: item?.priceLevels,
  });
  return recalculateStagedItem({
    quantity: billedQty,
    originalQuantity: billedQty,
    productDetail: detail,
    selectedUnit: item?.selectedUnit ?? detail?.selectedUnit ?? "",
    priceLevel: item?.priceLevel ?? null,
    rate: Number(item?.rate) || 0,
    taxType: item?.taxType || "igst",
    initialPriceSource: item?.initialPriceSource || "manual",
    taxInclusive: Boolean(item?.taxInclusive),
    actualQty,
    billedQty,
    alternateUnit: item?.alternateUnit ?? null,
    baseDenominator: item?.baseDenominator ?? null,
    altConversion: item?.altConversion ?? null,
    alternateActualQty: item?.alternateActualQty ?? null,
    alternateBilledQty: item?.alternateBilledQty ?? null,
    discountType: item?.discountType || "percentage",
    discountPercentage: Number(item?.discountPercentage) || 0,
    discountAmount: Number(item?.discountAmount) || 0,
    description: item?.description || "",
    warrantyCardId: item?.warrantyCardId || null,
    originalSnapshot: {
      rate: Number(item?.rate) || 0,
      taxInclusive: Boolean(item?.taxInclusive),
      actualQty,
      billedQty,
      discountType: item?.discountType || "percentage",
      discountPercentage: Number(item?.discountPercentage) || 0,
      discountAmount: Number(item?.discountAmount) || 0,
      description: item?.description || "",
      warrantyCardId: item?.warrantyCardId || null,
    },
  });
}

/**
 * Builds the item payload consumed by `ItemEditSheet`.
 *
 * @param {string} productId
 * @param {object} stagedItem
 * @returns {object} Editable item object with full tax/rate/qty fields.
 */
function buildEditableItem(productId, stagedItem) {
  const detail = buildProductDetail(stagedItem?.productDetail);
  return {
    id: productId,
    name: detail?.product_name || "Untitled Product",
    hsn: detail?.hsn || "",
    baseUnit: detail?.baseUnit || "",
    selectedUnit: stagedItem?.selectedUnit ?? detail?.baseUnit ?? "",
    alternateUnit: stagedItem?.alternateUnit ?? detail?.alternateUnit ?? null,
    baseDenominator: stagedItem?.baseDenominator ?? detail?.baseDenominator ?? null,
    altConversion: stagedItem?.altConversion ?? detail?.altConversion ?? null,
    alternateActualQty: stagedItem?.alternateActualQty ?? null,
    alternateBilledQty: stagedItem?.alternateBilledQty ?? null,
    taxRate: getProductTaxRate(detail),
    cgst: Number(detail?.cgst) || 0,
    sgst: Number(detail?.sgst) || 0,
    igst: Number(detail?.igst) || 0,
    cess: Number(detail?.cess) || 0,
    addl_cess: Number(detail?.addl_cess ?? detail?.addlCess) || 0,
    priceLevels: Array.isArray(detail?.priceLevels) ? detail.priceLevels : [],
    rate: Number(stagedItem?.rate) || 0,
    taxType: stagedItem?.taxType || "igst",
    initialPriceSource: stagedItem?.initialPriceSource || "manual",
    actualQty: Number(stagedItem?.actualQty ?? stagedItem?.quantity) || 0,
    billedQty: Number(stagedItem?.billedQty ?? stagedItem?.quantity) || 0,
    taxInclusive: Boolean(stagedItem?.taxInclusive),
    discountType: stagedItem?.discountType || "percentage",
    discountPercentage: Number(stagedItem?.discountPercentage) || 0,
    discountAmount: Number(stagedItem?.discountAmount) || 0,
    description: stagedItem?.description || "",
    warrantyCardId: stagedItem?.warrantyCardId || null,
    basePrice: 0,
    taxableAmount: 0,
    taxAmount: 0,
    totalAmount: 0,
  };
}

/**
 * Fetches party-specific last sale price (LSP) for a product.
 *
 * @param {string|null} partyId
 * @param {string} productId
 * @returns {Promise<number|null>}
 */
async function fetchPartyLsp(partyId, productId) {
  return productService.fetchPartyLsp(partyId, productId, { skipGlobalLoader: true });
}

/**
 * Fetches global last sale price (GSP) for a product.
 *
 * @param {string} productId
 * @returns {Promise<number|null>}
 */
async function fetchGlobalLsp(productId) {
  return productService.fetchGlobalLsp(productId, { skipGlobalLoader: true });
}

/**
 * Resolves the initial rate while adding a new item row.
 *
 * Resolution strategy:
 * 1) selected price-level rate
 * 2) party LSP
 * 3) global LSP
 * 4) manual 0
 *
 * @param {{
 *   partyId: string|null,
 *   productId: string,
 *   productDetail: object,
 *   priceLevel: string
 * }} params
 * @returns {Promise<{source: "priceLevel"|"lsp"|"gsp"|"manual", rate: number}>}
 */
async function resolveInitialRate({ partyId, productId, productDetail, priceLevel }) {
  // Rate resolution priority used while adding a brand new item row:
  // 1) price level rate (if price level selected)
  // 2) party LSP
  // 3) global LSP
  // 4) fallback manual 0
  if (priceLevel) {
    const levelRate = getPriceLevelRate(productDetail, priceLevel);
    return { source: "priceLevel", rate: levelRate != null ? Number(levelRate) || 0 : 0 };
  }
  const partyLsp = await fetchPartyLsp(partyId, productId);
  if (partyLsp != null && Number(partyLsp) > 0)
    return { source: "lsp", rate: Number(partyLsp) || 0 };
  const globalLsp = await fetchGlobalLsp(productId);
  if (globalLsp != null && Number(globalLsp) > 0)
    return { source: "gsp", rate: Number(globalLsp) || 0 };
  return { source: "manual", rate: 0 };
}


// ---------------------------------------------------------------------------
// ProductSelectPage
// ---------------------------------------------------------------------------

/**
 * Main sale-order item selection page.
 *
 * Responsibilities:
 * - fetch and filter products
 * - stage item changes locally (without immediately mutating transaction items)
 * - resolve initial rates and allow row editing
 * - commit staged changes back to Redux on "Continue"
 *
 * @returns {JSX.Element}
 */
export default function ProductSelectPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { setHeaderOptions, resetHeaderOptions } = useMobileHeader();
  const loadMoreRef = useRef(null);
  const didSeedRef = useRef(false);

  const reduxPriceLevel = useSelector((state) => state.transaction.priceLevel);
  const taxType = useSelector((state) => state.transaction.taxType);
  const transactionItems = useSelector((state) => state.transaction.items);
  const party = useSelector((state) => state.transaction.party);
  const cmp_id = useSelector((state) => state.company.selectedCompanyId) || "";

  const storedFilters = useMemo(() => getStoredProductFilters(cmp_id), [cmp_id]);

  const [search, setSearch] = useState(() => storedFilters?.search || "");
  const [appliedPriceLevel, setAppliedPriceLevel] = useState(
    () => reduxPriceLevel || storedFilters?.priceLevel || "",
  );
  const [brandId, setBrandId] = useState(() => storedFilters?.brandId || "");
  const [categoryId, setCategoryId] = useState(() => storedFilters?.categoryId || "");
  const [subcategoryId, setSubcategoryId] = useState(() => storedFilters?.subcategoryId || "");
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [stagedItems, setStagedItems] = useState({});
  const [productListUnits, setProductListUnits] = useState({});
  const [loadingProductIds, setLoadingProductIds] = useState({});
  const [editingProductId, setEditingProductId] = useState(null);
  const [pendingPriceLevelChange, setPendingPriceLevelChange] = useState(null);

  // ─── THE KEY REF ────────────────────────────────────────────────────────────
  // Tracks the price level last explicitly committed by the user via applyFilters.
  // NEVER auto-synced to state/Redux on every render — written ONLY inside
  // applyFilters. This eliminates all timing ambiguity: when handleFilterApply
  // reads it synchronously, it always reflects the last confirmed commit.
  const committedPriceLevelRef = useRef(
    reduxPriceLevel || storedFilters?.priceLevel || "",
  );

  // Kept in sync every render so async callbacks always see fresh staged items.
  const stagedItemsRef = useRef(stagedItems);
  stagedItemsRef.current = stagedItems;

  const debouncedSearch = useDebouncedValue(search.trim(), 500);
  const returnTo = location.state?.returnTo || ROUTES.createOrder;

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  const { data, error, isError, isLoading, isFetchingNextPage, fetchNextPage, hasNextPage } =
    useInfiniteProductListQuery({
      cmp_id,
      limit: PAGE_SIZE,
      search: debouncedSearch,
      brand: brandId,
      category: categoryId,
      subcategory: subcategoryId,
    });

  const { data: brandsData = [] } = useBrandsQuery({ cmp_id });
  const { data: priceLevelsData = [] } = usePriceLevelsQuery({ cmp_id });
  const { data: categoriesData = [] } = useCategoriesQuery({ cmp_id });
  const { data: subcategoriesData = [] } = useSubcategoriesQuery({ cmp_id });

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  // Re-hydrate filters whenever company changes.
  // Input: `cmp_id` and stored localStorage values.
  // Output: updates local filter states + committed price-level ref.
  useEffect(() => {
    if (!cmp_id) return;
    const nextFilters = getStoredProductFilters(cmp_id);
    if (!nextFilters) return;
    const pl = reduxPriceLevel || nextFilters.priceLevel || "";
    setSearch(nextFilters.search || "");
    setAppliedPriceLevel(pl);
    committedPriceLevelRef.current = pl; // keep the committed ref in sync on company change
    setBrandId(nextFilters.brandId || "");
    setCategoryId(nextFilters.categoryId || "");
    setSubcategoryId(nextFilters.subcategoryId || "");
  }, [cmp_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist latest applied filters for current company.
  useEffect(() => {
    persistProductFilters(cmp_id, {
      search,
      priceLevel: appliedPriceLevel,
      brandId,
      categoryId,
      subcategoryId,
    });
  }, [appliedPriceLevel, brandId, categoryId, cmp_id, search, subcategoryId]);

  // Seed local staged map from already selected transaction items (once per mount).
  useEffect(() => {
    if (didSeedRef.current) return;
    if (!Array.isArray(transactionItems) || transactionItems.length === 0) return;
    // Seed staged state from existing transaction items when user re-opens
    // the item selector during create/edit flow.
    const seeded = transactionItems.reduce((acc, item) => {
      if (!item?.id) return acc;
      acc[item.id] = createStagedItemFromTransactionItem(item);
      return acc;
    }, {});
    setStagedItems(seeded);
    didSeedRef.current = true;
  }, [transactionItems]);

  // Show toast for product-list query failures.
  useEffect(() => {
    if (!isError) return;
    toast.error(
      error?.response?.data?.message || error?.message || "Failed to load products",
    );
  }, [error, isError]);

  // Infinite scroll observer: when sentinel enters viewport, fetch next page.
  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: "180px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, data]);

  const filterSignature = useMemo(
    () =>
      [cmp_id, debouncedSearch, appliedPriceLevel, brandId, categoryId, subcategoryId].join("|"),
    [appliedPriceLevel, brandId, categoryId, cmp_id, debouncedSearch, subcategoryId],
  );

  const [products, setProducts] = useState([]);
  // Clear product list on filter signature change to avoid stale visual carryover.
  useEffect(() => { setProducts([]); }, [filterSignature]);
  // Flatten paginated query response into render-ready array.
  useEffect(() => {
    setProducts(data?.pages?.flatMap((page) => page?.items || []) || []);
  }, [data, filterSignature]);

  // ---------------------------------------------------------------------------
  // applyFilters — THE ONLY PLACE committedPriceLevelRef IS WRITTEN
  // ---------------------------------------------------------------------------

  /**
   * Applies final filter values to state + Redux.
   *
   * Input shape:
   * - `priceLevel`: selected price-level id
   * - `brandId`, `categoryId`, `subcategoryId`: selected master ids
   *
   * Side effects:
   * - updates local filter states used by product query
   * - updates committed price-level ref (synchronous read safety)
   * - updates Redux price-level fields for downstream sale-order payload flow
   *
   * @param {{ priceLevel?: string, brandId?: string, categoryId?: string, subcategoryId?: string }} candidate
   * @returns {void}
   */
  const applyFilters = useCallback(
    ({ priceLevel, brandId: nb, categoryId: nc, subcategoryId: ns }) => {
      const pl = priceLevel || "";

      // Write ref BEFORE state updates so any synchronous reader after this
      // call sees the new value immediately.
      committedPriceLevelRef.current = pl;

      setAppliedPriceLevel(pl);
      setBrandId(nb || "");
      setCategoryId(nc || "");
      setSubcategoryId(ns || "");

      const matchedPriceLevel = priceLevelsData.find(
        (level) => (level?._id || level?.id)?.toString() === pl,
      );
      // Keep Redux price-level identifiers in sync so other sale-order screens
      // and payload builders use the same selected level.
      dispatch(setPriceLevel(pl || null));
      dispatch(setPriceLevelObject(matchedPriceLevel ?? null));
    },
    [dispatch, priceLevelsData],
  );

  // ---------------------------------------------------------------------------
  // handleFilterApply — passed as onApply to FilterSheet
  //
  // Reads committedPriceLevelRef and stagedItemsRef synchronously at call time.
  // No closures over stale state, no useEffect timing gaps.
  // ---------------------------------------------------------------------------

  /**
   * Handles filter-sheet Apply action.
   *
   * Behavior:
   * - If price level changed and staged rows exist, asks for confirmation before re-pricing.
   * - Otherwise applies filters immediately.
   *
   * @param {{ priceLevel?: string, brandId?: string, categoryId?: string, subcategoryId?: string }} candidate
   * @returns {void}
   */
  const handleFilterApply = useCallback(
    (candidate) => {
      // Read the ref directly — this always reflects the last committed value
      // because applyFilters writes it before any async/state work.
      const committed = committedPriceLevelRef.current;

      const hasPriceLevelChanged =
        (candidate.priceLevel || "") !== (committed || "");

      const hasStagedItems = Object.values(stagedItemsRef.current).some(
        (item) => (Number(item?.quantity) || 0) > 0,
      );

      if (hasPriceLevelChanged && hasStagedItems) {
        setPendingPriceLevelChange(candidate);
      } else {
        applyFilters(candidate);
      }
    },
    [applyFilters],
  );

  // ---------------------------------------------------------------------------
  // Confirm / cancel price level change
  // ---------------------------------------------------------------------------

  /**
   * Confirms pending price-level change and re-prices staged rows.
   *
   * @returns {Promise<void>}
   */
  const confirmPriceLevelChange = useCallback(async () => {
    if (!pendingPriceLevelChange) return;
    const { priceLevel } = pendingPriceLevelChange;

    try {
      // Re-price all currently staged rows against the newly selected level.
      // Items missing that level will end up with rate 0 (intentional).
      const repricedEntries = await Promise.all(
        Object.entries(stagedItemsRef.current).map(async ([productId, staged]) => {
          const productDetail = await ensureProductDetail(staged?.productDetail, staged);
          const nextRate = getPriceLevelRate(productDetail, priceLevel);
          return [
            productId,
            recalculateStagedItem({
              ...staged,
              productDetail,
              priceLevel: priceLevel || null,
              rate: nextRate != null ? Number(nextRate) || 0 : 0,
              initialPriceSource: "priceLevel",
            }),
          ];
        }),
      );
      setStagedItems(Object.fromEntries(repricedEntries));
    } catch (e) {
      toast.error(e?.response?.data?.message || e?.message || "Failed to re-price items");
      return;
    }

    applyFilters(pendingPriceLevelChange);
    setPendingPriceLevelChange(null);
  }, [applyFilters, pendingPriceLevelChange]);

  /**
   * Dismisses pending price-level change confirmation dialog.
   *
   * @returns {void}
   */
  const cancelPriceLevelChange = useCallback(() => {
    setPendingPriceLevelChange(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Product detail helpers
  // ---------------------------------------------------------------------------

  /**
   * Ensures a product has detail-level pricing metadata (base unit + priceLevels etc).
   * Uses staged/cache data when sufficient; otherwise fetches by id.
   *
   * @param {object} product - Product/list/detail object.
   * @param {object|null} stagedItem - Existing staged row for this product, if any.
   * @returns {Promise<object>} Normalized product detail object.
   */
  const ensureProductDetail = async (product, stagedItem) => {
    const productId = getProductId(product) || stagedItem?.productDetail?._id;
    const existingDetail = stagedItem?.productDetail;
    if (
      existingDetail?.baseUnit &&
      Array.isArray(existingDetail?.priceLevels) &&
      existingDetail.priceLevels.length > 0
    ) {
      // Avoid extra API call when staged detail already has enough pricing metadata.
      return buildProductDetail(existingDetail);
    }
    const fetched = await getProductById(productId, { skipGlobalLoader: true });
    return buildProductDetail({
      ...(product || {}),
      ...(existingDetail || {}),
      ...(fetched || {}),
    });
  };

  /**
   * Marks/unmarks a product row as loading during async add/edit operations.
   *
   * @param {string} productId
   * @param {boolean} val
   * @returns {void}
   */
  const setLoading = (productId, val) => {
    setLoadingProductIds((cur) => {
      const next = { ...cur };
      if (val) next[productId] = true;
      else delete next[productId];
      return next;
    });
  };

  // ---------------------------------------------------------------------------
  // Add / increment / decrement
  // ---------------------------------------------------------------------------

  /**
   * Adds product to staged rows (or increments quantity if already staged).
   * For brand-new rows, resolves rate + source via `resolveInitialRate`.
   *
   * @param {object} product
   * @returns {Promise<void>}
   */
  const handleAddOrIncrement = async (product, selectedUnitOverride) => {
    const productId = getProductId(product);
    if (!productId) return;
    const selectedUnit =
      selectedUnitOverride ||
      productListUnits[productId] ||
      stagedItemsRef.current[productId]?.selectedUnit ||
      getProductBaseUnit(product);

    const existingItem = stagedItemsRef.current[productId];
    if (existingItem) {
      const changes = changeProductListQuantity(existingItem, selectedUnit, 1);
      setStagedItems((cur) => ({
        ...cur,
        [productId]: recalculateStagedItem({
          ...cur[productId],
          ...changes,
          quantity: changes.billedQty,
        }),
      }));
      return;
    }

    setLoading(productId, true);
    try {
      const productDetail = await ensureProductDetail(product, null);
      // Determine initial rate using the priority rule in `resolveInitialRate`.
      const { rate, source } = await resolveInitialRate({
        partyId: party?._id || party?.id || null,
        productId,
        productDetail,
        priceLevel: committedPriceLevelRef.current || "",
      });
      setStagedItems((cur) => {
        const alternateSnapshot = getAlternateUnitSnapshot(productDetail);
        const newItem = {
          baseUnit: productDetail.baseUnit,
          selectedUnit,
          ...alternateSnapshot,
          actualQty: 0,
          billedQty: 0,
          alternateActualQty: 0,
          alternateBilledQty: 0,
        };
        const changes = changeProductListQuantity(newItem, selectedUnit, 1);
        return {
          ...cur,
          [productId]: recalculateStagedItem({
            quantity: changes.billedQty,
            originalQuantity: 0,
            productDetail,
            rate,
            taxType: taxType || "igst",
            initialPriceSource: source,
            taxInclusive: false,
            ...changes,
            ...alternateSnapshot,
            discountType: "percentage",
            discountPercentage: 0,
            discountAmount: 0,
            description: "",
            warrantyCardId: null,
            originalSnapshot: null,
          }),
        };
      });
    } catch (e) {
      toast.error(e?.response?.data?.message || e?.message || "Failed to add product");
    } finally {
      setLoading(productId, false);
    }
  };

  /**
   * Decrements staged quantity for a product.
   *
   * Removal rule:
   * - For items that originally existed in transaction, keep row with qty=0.
   * - For newly staged items, remove row from staged map when qty reaches 0.
   *
   * @param {object} product
   * @returns {void}
   */
  const handleDecrement = (product, selectedUnitOverride) => {
    const productId = getProductId(product);
    if (!productId || !stagedItemsRef.current[productId]) return;
    const selectedUnit =
      selectedUnitOverride ||
      productListUnits[productId] ||
      stagedItemsRef.current[productId]?.selectedUnit ||
      getProductBaseUnit(product);
    setStagedItems((cur) => {
      const existing = cur[productId];
      const changes = changeProductListQuantity(existing, selectedUnit, -1);
      if (changes.billedQty <= 0 && changes.actualQty <= 0) {
        if ((Number(existing?.originalQuantity) || 0) > 0) {
          return {
            ...cur,
            [productId]: recalculateStagedItem({
              ...existing,
              ...changes,
              quantity: 0,
            }),
          };
        }
        const next = { ...cur };
        delete next[productId];
        return next;
      }
      return {
        ...cur,
        [productId]: recalculateStagedItem({
          ...existing,
          ...changes,
          quantity: changes.billedQty,
        }),
      };
    });
  };

  const handleProductListUnitChange = useCallback((product, selectedUnit) => {
    const productId = getProductId(product);
    if (!productId) return;
    setProductListUnits((current) => ({ ...current, [productId]: selectedUnit }));
    // Keep an already staged item and its edit sheet in sync with the list
    // choice, without recalculating quantities, rate, or totals.
    setStagedItems((current) => {
      const existing = current[productId];
      if (!existing) return current;

      return {
        ...current,
        [productId]: {
          ...existing,
          selectedUnit,
        },
      };
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Edit sheet
  // ---------------------------------------------------------------------------

  /**
   * Opens item edit sheet for one staged product.
   * Ensures full product detail is loaded first.
   *
   * @param {object} product
   * @returns {Promise<void>}
   */
  const openEditSheet = async (product) => {
    const productId = getProductId(product);
    const stagedItem = stagedItemsRef.current[productId];
    if (!productId || !stagedItem) return;
    try {
      const productDetail = await ensureProductDetail(product, stagedItem);
      setStagedItems((cur) => ({
        ...cur,
        [productId]: recalculateStagedItem({
          ...cur[productId],
          productDetail,
          ...getAlternateUnitSnapshot(productDetail),
          selectedUnit: cur[productId]?.selectedUnit ?? productDetail?.baseUnit ?? "",
        }),
      }));
      setEditingProductId(productId);
    } catch (e) {
      toast.error(e?.response?.data?.message || e?.message || "Failed to load item details");
    }
  };

  /**
   * Applies edits coming from ItemEditSheet into local staged state.
   *
   * @param {object} changes - Partial editable item changes from sheet.
   * @returns {void}
   */
  const handleStagedSave = (changes) => {
    if (!editingProductId) return;
    if (changes?.selectedUnit) {
      setProductListUnits((current) => ({
        ...current,
        [editingProductId]: changes.selectedUnit,
      }));
    }
    setStagedItems((cur) => {
      const existing = cur[editingProductId];
      if (!existing) return cur;
      const nextBilledQty = Number(changes?.billedQty) || 0;
      const parsedActualQty = Number(changes?.actualQty);
      const nextActualQty = Number.isFinite(parsedActualQty)
        ? parsedActualQty
        : nextBilledQty;
      return {
        ...cur,
        [editingProductId]: recalculateStagedItem({
          ...existing,
          ...changes,
          quantity: nextBilledQty,
          billedQty: nextBilledQty,
          actualQty: nextActualQty,
          rate: Number(changes?.rate) || 0,
          discountType: changes?.discountType || existing?.discountType || "percentage",
          discountPercentage: Number(changes?.discountPercentage) || 0,
          discountAmount: Number(changes?.discountAmount) || 0,
        }),
      };
    });
  };

  /**
   * Removes one staged row (or sets qty=0 for originally existing rows).
   *
   * @param {{id?: string}|null} item
   * @returns {void}
   */
  const handleStagedRemove = useCallback((item) => {
    const productId = item?.id || editingProductId;
    if (!productId) return;

    setStagedItems((cur) => {
      const existing = cur[productId];
      if (!existing) return cur;

      if ((Number(existing?.originalQuantity) || 0) > 0) {
        return {
          ...cur,
          [productId]: recalculateStagedItem({
            ...existing,
            quantity: 0,
            billedQty: 0,
            actualQty: 0,
          }),
        };
      }

      const next = { ...cur };
      delete next[productId];
      return next;
    });
  }, [editingProductId]);

  // ---------------------------------------------------------------------------
  // Continue / Done
  // ---------------------------------------------------------------------------

  /**
   * Commits staged changes back to Redux transaction state and returns.
   *
   * Commit behavior:
   * - Existing rows -> `updateItem`
   * - New rows -> batched through `addItemsFromSelection`
   *
   * @returns {void}
   */
  const handleContinue = useCallback(() => {
    const payload = [];

    Object.entries(stagedItemsRef.current).forEach(([productId, staged]) => {
      const detail = buildProductDetail(staged?.productDetail);
      const quantity = Number(staged?.quantity) || 0;
      const originalQuantity = Number(staged?.originalQuantity) || 0;
      const baseChanges = {
        rate: Number(staged?.rate) || 0,
        priceLevel: staged?.priceLevel ?? committedPriceLevelRef.current ?? null,
        initialPriceSource: staged?.initialPriceSource || "manual",
        selectedUnit: staged?.selectedUnit ?? detail?.baseUnit ?? "",
        taxInclusive: Boolean(staged?.taxInclusive),
        discountType: staged?.discountType || "percentage",
        discountPercentage: Number(staged?.discountPercentage) || 0,
        discountAmount: Number(staged?.discountAmount) || 0,
        description: staged?.description || "",
        warrantyCardId: staged?.warrantyCardId || null,
        alternateActualQty: staged?.alternateActualQty ?? null,
        alternateBilledQty: staged?.alternateBilledQty ?? null,
      };

      if (originalQuantity > 0) {
        // Existing item from transaction: update in-place instead of re-adding.
        const nextActualQty =
          quantity > 0
            ? Number(staged?.actualQty ?? quantity) || quantity
            : 0;

        dispatch(
          updateItem({
            id: productId,
            changes: {
              ...baseChanges,
              actualQty: nextActualQty,
              billedQty: quantity,
              alternateUnit: staged?.alternateUnit ?? null,
              baseDenominator: staged?.baseDenominator ?? null,
              altConversion: staged?.altConversion ?? null,
              selectedUnit: staged?.selectedUnit ?? detail?.baseUnit ?? "",
            },
          }),
        );

        return;
      }

      if (quantity <= 0) {
        // Skip rows user removed down to zero quantity.
        return;
      }

      // Brand-new staged row: convert to transaction item shape for reducer.
      payload.push({
        id: productId,
        name: detail?.product_name || "Untitled Product",
        hsn: detail?.hsn || "",
        baseUnit: detail?.baseUnit || "",
        selectedUnit: staged?.selectedUnit ?? detail?.baseUnit ?? "",
        alternateUnit: staged?.alternateUnit ?? detail?.alternateUnit ?? null,
        baseDenominator: staged?.baseDenominator ?? detail?.baseDenominator ?? null,
        altConversion: staged?.altConversion ?? detail?.altConversion ?? null,
        taxRate: getProductTaxRate(detail),
        priceLevels: Array.isArray(detail?.priceLevels) ? detail.priceLevels : [],
        priceLevel: committedPriceLevelRef.current || null,
        rate: Number(staged?.rate) || 0,
        cgst: Number(detail?.cgst) || 0,
        sgst: Number(detail?.sgst) || 0,
        igst: Number(detail?.igst) || 0,
        cess: Number(detail?.cess) || 0,
        addl_cess: Number(detail?.addl_cess ?? detail?.addlCess) || 0,
        taxType: staged?.taxType || taxType || "igst",
        initialPriceSource: staged?.initialPriceSource || "manual",
        actualQty: Number(staged?.actualQty ?? quantity) || 0,
        billedQty: Number(staged?.billedQty ?? quantity) || 0,
        alternateActualQty: staged?.alternateActualQty ?? null,
        alternateBilledQty: staged?.alternateBilledQty ?? null,
        taxInclusive: Boolean(staged?.taxInclusive),
        discountType: staged?.discountType || "percentage",
        discountPercentage: Number(staged?.discountPercentage) || 0,
        discountAmount: Number(staged?.discountAmount) || 0,
        description: staged?.description || "",
        warrantyCardId: staged?.warrantyCardId || null,
        basePrice: 0,
        taxableAmount: 0,
        taxAmount: 0,
        totalAmount: 0,
      });
    });

    if (payload.length > 0) dispatch(addItemsFromSelection(payload));
    navigate(returnTo);
  }, [dispatch, navigate, returnTo, taxType]);

  // ---------------------------------------------------------------------------
  // Mobile header
  // ---------------------------------------------------------------------------

  /**
   * Opens filter sheet from mobile/desktop header action.
   *
   * @returns {void}
   */
  const openFilterSheet = useCallback(() => setIsFilterSheetOpen(true), []);

  // Registers page-specific mobile header controls and search binding.
  useEffect(() => {
    setHeaderOptions({
      showMenuDots: true,
      actionButtons: [
        {
          label: "Done",
          primaryButton: true,
          onClick: handleContinue,
          variant: "default",
          size: "sm",
          className: "px-2.5 w-[110px] bg-violet-800 text-white",
        },
        {
          label: "",
          icon: SlidersHorizontal,
          onClick: openFilterSheet,
          variant: "outline",
          size: "sm",
          className: "px-2.5",
        },
        {
          label: "",
          icon: Barcode,
          onClick: () => {},
          variant: "outline",
          size: "sm",
          className: "px-2.5",
        },
      ],
      search: {
        show: true,
        value: search,
        placeholder: "Search products by name or code",
        onChange: setSearch,
      },
    });
    return () => resetHeaderOptions();
  }, [handleContinue, openFilterSheet, resetHeaderOptions, search, setHeaderOptions]);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const editingStagedItem = editingProductId ? stagedItems[editingProductId] || null : null;

  const stagedItemCount = useMemo(
    () =>
      Object.values(stagedItems).filter((item) => (Number(item?.quantity) || 0) > 0).length,
    [stagedItems],
  );

  const filterCount = useMemo(
    () => [appliedPriceLevel, brandId, categoryId, subcategoryId].filter(Boolean).length,
    [appliedPriceLevel, brandId, categoryId, subcategoryId],
  );

  // ---------------------------------------------------------------------------
  // Early return
  // ---------------------------------------------------------------------------

  if (!cmp_id) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          Select a company first to choose items.
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      <div className="flex h-full min-h-0 overflow-hidden flex-col bg-slate-50">
        <header className="hidden shrink-0 border-b border-slate-200 bg-white px-4 py-3 md:block">
          <div className="mx-auto flex max-w-5xl flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-sm font-semibold text-slate-900">Select Items</h1>
                <p className="truncate text-[11px] text-slate-500">
                  {party?.partyName || "No party selected"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" onClick={handleContinue}>
                  <span className="hidden sm:inline">Continue</span>
                  <span className="sm:hidden">Done</span>
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={openFilterSheet}>
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span>Filters{filterCount > 0 ? ` (${filterCount})` : ""}</span>
                </Button>
                <Button type="button" variant="outline" size="sm">
                  <Barcode className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Scan</span>
                </Button>
              </div>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products by name or code"
                className="min-h-11 pl-9 pr-10 text-sm"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-5xl min-h-0 flex-1 flex-col overflow-hidden py-1 sm:py-4">
          <div className="min-h-0 flex-1 overflow-hidden rounded-sm border border-slate-200 bg-white">
            <ScrollArea key={filterSignature} className="h-full">
              <div className="space-y-3 p-3 sm:p-4">
                {isLoading && (
                  <div className="space-y-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div
                        key={i}
                        className="h-28 animate-pulse rounded-xl border border-slate-200 bg-slate-50"
                      />
                    ))}
                  </div>
                )}

                {!isLoading && products.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                    {debouncedSearch ? "No matching products found" : "No products found"}
                  </div>
                )}

                {!isLoading &&
                  products.map((product) => {
                    const productId = getProductId(product);
                    return (
                      <ExtractedProductRow
                        key={productId}
                        product={product}
                        stagedItem={stagedItems[productId]}
                        loading={Boolean(loadingProductIds[productId])}
                        priceLevel={appliedPriceLevel || ""}
                        selectedUnit={
                          productListUnits[productId] ||
                          stagedItems[productId]?.selectedUnit ||
                          getProductBaseUnit(product)
                        }
                        onSelectedUnitChange={handleProductListUnitChange}
                        onAdd={handleAddOrIncrement}
                        onEdit={openEditSheet}
                        onIncrement={handleAddOrIncrement}
                        onDecrement={handleDecrement}
                      />
                    );
                  })}

                {hasNextPage && <div ref={loadMoreRef} className="h-4 w-full" />}

                {isFetchingNextPage && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-sm text-slate-600">
                    Loading more products...
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>

      {/* No key prop — FilterSheet resets its draft state via useEffect on open */}
      <ExtractedProductFilterSheet
        open={isFilterSheetOpen}
        onOpenChange={setIsFilterSheetOpen}
        appliedPriceLevel={appliedPriceLevel}
        appliedBrandId={brandId}
        appliedCategoryId={categoryId}
        appliedSubcategoryId={subcategoryId}
        priceLevels={Array.isArray(priceLevelsData) ? priceLevelsData : []}
        brands={Array.isArray(brandsData) ? brandsData : []}
        categories={Array.isArray(categoriesData) ? categoriesData : []}
        subcategories={Array.isArray(subcategoriesData) ? subcategoriesData : []}
        onApply={handleFilterApply}
      />

      <ItemEditSheet
        open={Boolean(editingStagedItem)}
        onOpenChange={(open) => { if (!open) setEditingProductId(null); }}
        item={
          editingProductId && editingStagedItem
            ? buildEditableItem(editingProductId, editingStagedItem)
            : null
        }
        onSave={handleStagedSave}
        onRemove={handleStagedRemove}
      />

      {pendingPriceLevelChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">Change Price Level?</h2>
            <p className="mt-2 text-sm text-slate-600">
              {stagedItemCount} staged item{stagedItemCount === 1 ? "" : "s"} will be re-priced
              to{" "}
              {priceLevelsData.find(
                (l) =>
                  (l?._id || l?.id)?.toString() ===
                  pendingPriceLevelChange?.priceLevel?.toString(),
              )?.pricelevel || "Default"}
              . Items without this price level will be set to rate 0.
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <Button type="button" variant="outline" onClick={cancelPriceLevelChange}>
                Cancel
              </Button>
              <Button type="button" onClick={confirmPriceLevelChange}>
                Yes, Re-price
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
