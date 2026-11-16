"use client";

import Link from "next/link";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export type MenuItem = {
  id: string;
  label: string;
  href?: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** Visual divider above this item. */
  separated?: boolean;
};

/**
 * Button that opens a popover. Closes on Escape, outside click and selection,
 * and returns focus to the button. With `items` it behaves as an ARIA menu
 * (arrow keys move, Enter selects); with `children` it is a free-form panel.
 */
export function Popover({
  label,
  trigger,
  items,
  children,
  align = "right",
  className = "",
  badge,
}: {
  label: string;
  trigger: ReactNode;
  items?: MenuItem[];
  children?: ReactNode;
  align?: "left" | "right";
  className?: string;
  badge?: number;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open && items)
      root.current
        ?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled])')
        ?.focus();
  }, [open, items]);

  const move = (event: KeyboardEvent) => {
    if (!items) return;
    const nodes = [
      ...(root.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"])',
      ) ?? []),
    ];
    const at = nodes.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") nodes[(at + 1) % nodes.length]?.focus();
    else if (event.key === "ArrowUp")
      nodes[(at - 1 + nodes.length) % nodes.length]?.focus();
    else if (event.key === "Home") nodes[0]?.focus();
    else if (event.key === "End") nodes[nodes.length - 1]?.focus();
    else return;
    event.preventDefault();
  };

  const close = () => setOpen(false);
  return (
    <div className={`console-pop ${className}`} ref={root}>
      <button
        ref={button}
        type="button"
        className="console-icon-btn"
        aria-label={label}
        aria-haspopup={items ? "menu" : "dialog"}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
        {badge ? (
          <span className="console-badge" aria-hidden="true">
            {badge > 9 ? "9+" : badge}
          </span>
        ) : null}
      </button>
      {open && (
        <div
          id={panelId}
          className="console-pop-panel"
          data-align={align}
          role={items ? "menu" : "dialog"}
          aria-label={label}
          onKeyDown={move}
        >
          {items
            ? items.map((item) => {
                const props = {
                  role: "menuitem",
                  className: "console-menu-item",
                  "data-separated": item.separated || undefined,
                  "aria-disabled": item.disabled || undefined,
                  tabIndex: -1,
                };
                return item.href && !item.disabled ? (
                  <Link
                    key={item.id}
                    href={item.href}
                    {...props}
                    onClick={close}
                  >
                    {item.label}
                  </Link>
                ) : (
                  <button
                    key={item.id}
                    type="button"
                    {...props}
                    disabled={item.disabled}
                    onClick={() => {
                      close();
                      item.onSelect?.();
                    }}
                  >
                    {item.label}
                  </button>
                );
              })
            : children}
        </div>
      )}
    </div>
  );
}
