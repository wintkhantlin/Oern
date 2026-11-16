"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import {
  MobileNav,
  type MobileNavItem,
  signOut,
} from "@/components/delivery/common";
import { Icon } from "@/components/delivery/icons";
import {
  type ManagerNavId,
  managerMobileNav,
  managerNavGroups,
} from "@/components/delivery/manager-sidebar";
import { ManagerThemeProvider } from "@/components/delivery/mui-provider";
import type { useWorkspace } from "@/lib/delivery/use-workspace";
import { Breadcrumbs, type Crumb } from "./breadcrumbs";
import "./console.css";
import { type MenuItem, Popover } from "./menu";

type Workspace = ReturnType<typeof useWorkspace>;
const NAV_KEY = "oern.console.nav";
const NARROW = "(max-width: 1023px)";

export type ConsoleShellProps = {
  active: ManagerNavId;
  workspace: Workspace;
  onSignIn: () => void;
  /** Breadcrumb segments between "Oern" and the current page. */
  crumbs?: Crumb[];
  /** Overrides the last breadcrumb (defaults to the nav label). */
  pageTitle?: string;
  /** Page-specific controls in the top bar, e.g. refresh. */
  toolbar?: ReactNode;
  /** Phone bottom bar; defaults to the standard manager one. */
  mobileNav?: { items: readonly MobileNavItem[]; activeId?: string };
  navCounts?: { orderCount?: number; movingCount?: number };
  dataView?: string;
  className?: string;
  children: ReactNode;
};

export function ConsoleShell({
  active,
  workspace,
  onSignIn,
  crumbs = [],
  pageTitle,
  toolbar,
  mobileNav,
  navCounts,
  dataView,
  className = "",
  children,
}: ConsoleShellProps) {
  const groups = useMemo(() => managerNavGroups(navCounts), [navCounts]);
  const current = groups.flatMap((g) => g.items).find((i) => i.id === active);
  const group = groups.find((g) => g.items.some((i) => i.id === active));

  /* ---- side navigation: collapsible, a drawer on narrow screens ---- */
  const [navOpen, setNavOpen] = useState(true);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(NARROW);
    const sync = () => {
      setNarrow(query.matches);
      if (query.matches) setNavOpen(false);
      else {
        // Laptop widths start collapsed so dense workspaces get the room.
        const roomy = window.matchMedia("(min-width: 1280px)").matches;
        try {
          const saved = localStorage.getItem(NAV_KEY);
          setNavOpen(saved ? saved === "open" : roomy);
        } catch {
          setNavOpen(roomy);
        }
      }
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const toggleNav = () => {
    const next = !navOpen;
    setNavOpen(next);
    if (!narrow) {
      try {
        localStorage.setItem(NAV_KEY, next ? "open" : "closed");
      } catch {
        /* The choice still holds for this visit. */
      }
    }
  };

  const signedIn = workspace.isAuthenticated;
  const name = workspace.profile?.full_name || "Team member";
  const userItems: MenuItem[] = [
    {
      id: "who",
      label: `${name}, ${workspace.profile?.role ?? "manager"}`,
      disabled: true,
    },
    { id: "team", label: "Team roster", href: "/manager/profile" },
    { id: "access", label: "Access & roles", href: "/manager/access" },
    {
      id: "out",
      label: "Sign out",
      onSelect: () => void signOut(),
      separated: true,
    },
  ];

  const trail: Crumb[] = [
    { label: "Oern", href: "/manager/home" },
    ...(group && active !== "home" ? [{ label: group.label }] : []),
    ...crumbs,
    { label: pageTitle ?? current?.label ?? "Manager" },
  ];
  const bottom = mobileNav ?? {
    items: managerMobileNav({
      id: "more",
      label: current?.label ?? "More",
      href: current?.href ?? "/manager/home",
      icon: current?.icon ?? "menu",
    }),
    activeId: "more",
  };

  return (
    <ManagerThemeProvider>
      <div
        className={`manager-app console ${className}`}
        data-nav={navOpen ? "open" : "closed"}
        data-view={dataView}
      >
        <a className="console-skip" href="#console-main">
          Skip to main content
        </a>
        <header className="console-topbar">
          <button
            type="button"
            className="console-icon-btn"
            aria-label={navOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={navOpen}
            aria-controls="console-nav"
            onClick={toggleNav}
          >
            <Icon name="menu" size={18} />
          </button>
          <Link className="console-brand" href="/manager/home">
            <span aria-hidden="true">O</span>
            <b className="console-brand-name">Oern</b>
          </Link>

          <div className="console-top-actions">
            {toolbar}
            {signedIn ? (
              <Popover
                label="Account"
                className="console-user"
                trigger={
                  <span className="console-avatar" aria-hidden="true">
                    {name[0]?.toUpperCase()}
                  </span>
                }
                items={userItems}
              />
            ) : (
              <button
                type="button"
                className="console-signin"
                onClick={onSignIn}
              >
                Sign in
              </button>
            )}
          </div>
        </header>

        <nav
          id="console-nav"
          className="console-nav"
          aria-label="Manager navigation"
          hidden={!navOpen}
        >
          {groups.map((g) => (
            <div className="console-nav-group" key={g.label}>
              <div className="console-nav-label">{g.label}</div>
              <ul>
                {g.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      aria-current={item.id === active ? "page" : undefined}
                      onClick={() => narrow && setNavOpen(false)}
                    >
                      <Icon name={item.icon} size={16} />
                      {item.label}
                      {item.count ? <span>{item.count}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        {narrow && navOpen && (
          <button
            type="button"
            className="console-scrim"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
          />
        )}

        <div className="console-main" id="console-main" tabIndex={-1}>
          <Breadcrumbs items={trail} />
          {children}
        </div>

        <MobileNav
          label="Manager workspace"
          items={bottom.items}
          activeId={bottom.activeId}
        />
      </div>
    </ManagerThemeProvider>
  );
}
