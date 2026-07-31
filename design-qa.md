# Sale Order Detail Top Design QA

- Source visual truth: `/Users/midhun/Developer/erp_v2/erp_v2/design-qa-sale-order-reference.jpeg`
- Primary-color source: `/var/folders/mr/42zm75xj0sq65jwx7t9xxl_m0000gn/T/codex-clipboard-b7b82996-8b75-4ef0-8890-7578b0ed1714.png`
- Implementation screenshot: `/Users/midhun/Developer/erp_v2/erp_v2/design-qa-sale-order-detail-mobile.jpeg`
- Side-by-side comparison: `/Users/midhun/Developer/erp_v2/erp_v2/design-qa-sale-order-detail-comparison.png`
- Viewport: 393 × 852 CSS px
- Source pixels: 1216 × 1012
- Implementation pixels: 393 × 852 at device scale factor 1
- Density normalization: the reference was scaled to 580 px wide without changing its aspect ratio; the implementation remained at its native 393 × 852 capture size.
- State: open sale order with realistic voucher, party, date, and final-amount data.

## Full-view comparison evidence

The rendered mobile detail screen follows the supplied and native-app composition: a centered `Sale Order Details` header, dark primary hero card, top-right status pill, voucher/date/party hierarchy, divider, final-amount block, and a four-button Edit/Cancel/Print/Share row. The existing summary tiles and detail content continue below the requested top region without overlap or horizontal overflow.

## Focused region comparison evidence

The combined comparison focuses on the header, hero card, and action row because those are the requested redesign surfaces. The hero and actions preserve the reference proportions and hierarchy at 393 px. The implementation intentionally uses the supplied `#004178` primary swatch instead of the reference screenshot's desaturated blue-grey. The longer realistic party name truncates on one line while the date remains unbroken.

## Required fidelity surfaces

- Fonts and typography: the product's Geist font remains in use. The prominent header is 18 px/extrabold, voucher is 22 px/extrabold, final amount is 25 px/extrabold, and labels use compact uppercase tracking consistent with the native app.
- Spacing and layout rhythm: the header uses the native app's larger back control and title scale. The hero uses 20 px padding, a 15 px radius, a clear divider, and a compact 8 px gap above the four equal action buttons.
- Colors and visual tokens: `#004178` is the primary hero/action color sampled from the supplied swatch. Status and cancellation retain semantic emerald and rose treatments with accessible contrast.
- Image quality and asset fidelity: the redesigned top contains no raster imagery. Pencil, cancel, printer, share, and back icons use the project's Lucide library and remain sharp at mobile density.
- Copy and content: `Sale Order Details`, `Sale Order`, `Open`, `Final Amount`, `Edit`, `Cancel`, `Print`, and `Share` match the source/native UI. Voucher, date, party, status, and amount remain live values.

## Interaction and runtime checks

- Cancel opens the existing confirmation dialog; `Keep Active` closes it correctly.
- Edit preserves the existing route behavior and is disabled unless the order is open.
- Print preserves the existing PDF-generation behavior.
- Share uses the browser's native share sheet when available and copies formatted order details otherwise.
- Targeted lint passes for all changed files.
- Production build passes.
- No browser console errors were present on the tested screen.

## Comparison history

1. Initial browser capture found a P2 header-scale mismatch and a P2 metadata wrapping issue: the web title/back icon were smaller than the native reference, and the date could wrap beside a long party name.
2. The detail route now requests a prominent 18 px header with a 24 px back icon, matching the native `ScreenHeader`. The date was made non-shrinking/non-wrapping while the party name truncates.
3. Post-fix evidence in `design-qa-sale-order-detail-comparison.png` shows the header hierarchy, card structure, metadata line, final amount, and four actions aligned with the reference. No actionable P0, P1, or P2 differences remain.

## Follow-up polish

- P3: the reference is a cropped top-region image rather than a complete 393 × 852 screen, so lower-page content is verified for continuity and overflow rather than pixel-level reference matching.

final result: passed
