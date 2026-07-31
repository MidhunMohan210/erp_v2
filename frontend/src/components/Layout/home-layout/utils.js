import { routeTitleMap } from "./constants";
import { ROUTES } from "@/routes/paths";

export function getUserDisplayName(user) {
  return user?.userName || user?.name || user?.email || "User";
}

export function getInitials(name) {
  const text = String(name || "").trim();

  if (!text) return "U";

  const parts = text.split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

export function getPageTitle(pathname) {
  if (routeTitleMap[pathname]) return routeTitleMap[pathname];
  if (
    /^\/transactions\/saleOrder\/[^/]+$/.test(pathname) ||
    /^\/sale-orders\/[^/]+$/.test(pathname)
  ) {
    return "Sale Order Details";
  }
  if (/^\/sale-orders\/[^/]+\/edit$/.test(pathname)) {
    return "Edit Sale Order";
  }
  if (pathname.startsWith("/outstanding/party/")) {
    return "Outstanding Details";
  }
  if (pathname.startsWith("/transactions/")) {
    return "Transaction";
  }
  if (pathname.startsWith("/sale-orders/")) {
    return "Sale Order";
  }

  const segment = pathname.split("/").filter(Boolean).at(-1);
  if (!segment) return "Home";

  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function isHomePath(pathname) {
  return pathname === ROUTES.home;
}
