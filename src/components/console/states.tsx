import type { ReactNode } from "react";

export type StateKind =
  "loading" | "error" | "empty" | "unauthorized" | "warning";

/**
 * One block for every non-happy state, so loading, empty, error and
 * unauthorized look and read the same wherever they appear.
 */
export function StateBlock({
  kind,
  title,
  children,
  action,
}: {
  kind: StateKind;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className="console-state"
      data-kind={kind}
      role={kind === "error" || kind === "unauthorized" ? "alert" : "status"}
      aria-live={kind === "loading" ? "polite" : undefined}
      aria-busy={kind === "loading" || undefined}
    >
      {kind === "loading" && (
        <span className="console-spinner" aria-hidden="true" />
      )}
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}
