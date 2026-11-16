"use client";

import type { ReactNode } from "react";
import type { useWorkspace } from "@/lib/delivery/use-workspace";
import { StateBlock } from "./states";

type Workspace = ReturnType<typeof useWorkspace>;

/**
 * Page-level permission boundary. Row-level security in Supabase is the real
 * enforcement; this makes the outcome clear instead of showing empty data.
 */
export function RequireManager({
  workspace,
  resource,
  onSignIn,
  children,
}: {
  workspace: Workspace;
  resource: string;
  onSignIn: () => void;
  children: ReactNode;
}) {
  if (workspace.isLoading)
    return <StateBlock kind="loading" title={`Loading ${resource}…`} />;
  if (!workspace.isAuthenticated && !workspace.isDemo)
    return (
      <StateBlock
        kind="unauthorized"
        title="Sign in required"
        action={
          <button
            type="button"
            className="button button-primary"
            onClick={onSignIn}
          >
            Sign in
          </button>
        }
      >
        {resource} is available to manager accounts.
      </StateBlock>
    );
  if (
    workspace.isAuthenticated &&
    workspace.profile &&
    workspace.profile.role !== "manager"
  )
    return (
      <StateBlock kind="unauthorized" title="You don’t have access">
        {resource} is limited to manager accounts. Your account is{" "}
        {workspace.profile.role}.
      </StateBlock>
    );
  return <>{children}</>;
}
