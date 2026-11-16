import Link from "next/link";

import type { MobileNavItem } from "@/components/delivery/common";
import { Icon, type IconName } from "@/components/delivery/icons";

export type ManagerNavId =
  | "home"
  | "order"
  | "track"
  | "create"
  | "complaints"
  | "profile"
  | "jobs"
  | "flood"
  | "vehicles"
  | "cod"
  | "business"
  | "coupons"
  | "routing"
  | "audit"
  | "access";

export type NavItem = {
  id: ManagerNavId;
  label: string;
  href: string;
  icon: IconName;
  count?: number;
};

export type ManagerNavGroup = { label: string; items: NavItem[] };

/** Every manager page, grouped. The console shell and the legacy sidebar read this. */
export function managerNavGroups({
  orderCount = 0,
  movingCount = 0,
}: {
  orderCount?: number;
  movingCount?: number;
} = {}): ManagerNavGroup[] {
  return [
    {
      label: "Operations",
      items: [
        {
          id: "home",
          label: "Overview",
          href: "/manager/home",
          icon: "delivery",
        },
        {
          id: "order",
          label: "Orders",
          href: "/manager/order",
          icon: "box",
          count: orderCount,
        },
        {
          id: "track",
          label: "Live tracking",
          href: "/manager/track",
          icon: "track",
          count: movingCount,
        },
        {
          id: "create",
          label: "Create order",
          href: "/manager/order/create",
          icon: "plus",
        },
        {
          id: "jobs",
          label: "Jobs",
          href: "/manager/jobs",
          icon: "spark",
        },
        {
          id: "flood",
          label: "Flood watch",
          href: "/manager/flood-watch",
          icon: "flood",
        },
        {
          id: "routing",
          label: "Route lab",
          href: "/manager/routing",
          icon: "compass",
        },
      ],
    },
    {
      label: "Resources",
      items: [
        {
          id: "vehicles",
          label: "Vehicles",
          href: "/manager/vehicles",
          icon: "truck",
        },
        {
          id: "profile",
          label: "Team roster",
          href: "/manager/profile",
          icon: "users",
        },
      ],
    },
    {
      label: "Customers & finance",
      items: [
        {
          id: "complaints",
          label: "Complaints",
          href: "/manager/complaints",
          icon: "help",
        },
        { id: "cod", label: "COD ledger", href: "/manager/cod", icon: "coin" },
        {
          id: "business",
          label: "Business",
          href: "/manager/business",
          icon: "store",
        },
        {
          id: "coupons",
          label: "Coupons",
          href: "/manager/coupons",
          icon: "wallet",
        },
      ],
    },
    {
      label: "Administration",
      items: [
        {
          id: "audit",
          label: "Audit log",
          href: "/manager/audit",
          icon: "history",
        },
        {
          id: "access",
          label: "Access & roles",
          href: "/manager/access",
          icon: "shield",
        },
      ],
    },
  ];
}

export function ManagerSidebar({
  active,
  orderCount = 0,
  movingCount = 0,
}: {
  active?: ManagerNavId;
  orderCount?: number;
  movingCount?: number;
}) {
  const groups = managerNavGroups({ orderCount, movingCount });

  return (
    <aside className="manager-sidebar">
      {groups.map((group) => (
        <div className="manager-sidebar-group" key={group.label}>
          <div className="manager-sidebar-label">{group.label}</div>
          <nav className="manager-side-nav" aria-label={group.label}>
            {group.items.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className={active === item.id ? "side-nav-active" : undefined}
                aria-current={active === item.id ? "page" : undefined}
              >
                <Icon name={item.icon} size={17} />
                {item.label}
                {item.count ? <span>{item.count}</span> : null}
              </Link>
            ))}
          </nav>
        </div>
      ))}
    </aside>
  );
}

/** Phone bottom bar for manager pages that live outside the main manager app. */
export function managerMobileNav(current: MobileNavItem): MobileNavItem[] {
  return [
    { id: "home", label: "Overview", href: "/manager/home", icon: "delivery" },
    { id: "order", label: "Orders", href: "/manager/order", icon: "box" },
    { id: "track", label: "Track", href: "/manager/track", icon: "track" },
    { id: "cod", label: "COD", href: "/manager/cod", icon: "coin" },
    current,
  ];
}
