import DaybookPage from "@/pages/Home/DaybookPage";

const SALE_ORDER_ONLY = [{ value: "saleOrder", label: "Sale Order" }];

export default function ConvertedOrdersPage() {
  return (
    <DaybookPage
      title="Converted Orders"
      fixedStatus="converted"
      voucherTypeOptions={SALE_ORDER_ONLY}
    />
  );
}
