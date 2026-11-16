"use client";

import { useEffect } from "react";

const MESSAGE = "You have unsaved changes. Leave without saving?";

/**
 * While `dirty`, warn before the tab closes or reloads, and before an
 * in-app link navigates away. Saving or cancelling sets `dirty` false.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.target === "_blank" || event.defaultPrevented) return;
      const next = new URL(link.href, window.location.href);
      if (
        next.origin !== window.location.origin ||
        (next.pathname === window.location.pathname &&
          next.search === window.location.search)
      )
        return;
      if (!window.confirm(MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}
