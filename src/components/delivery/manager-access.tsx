"use client";

import Link from "next/link";
import { useState } from "react";

import { RequireManager } from "@/components/console/access-gate";
import { ConsoleShell } from "@/components/console/console-shell";
import {
  type Column,
  ResourceTable,
  type TableFilter,
} from "@/components/console/resource-table";
import { AuthDialog } from "@/components/delivery/auth-dialog";
import { PageHeader } from "@/components/delivery/common";
import {
  Container,
  StatusIndicator,
  type Tone,
} from "@/components/delivery/manager-home-view";
import { sentenceCase } from "@/lib/delivery/format";
import type { OperationsProfile } from "@/lib/delivery/operations-types";
import { useOperationsWorkspace } from "@/lib/delivery/use-operations-workspace";
import { useWorkspace } from "@/lib/delivery/use-workspace";

type Person = OperationsProfile;

/** Mirrors workspaceHome() and workspaceRedirect() in lib/delivery/access.ts. */
const ROLES: {
  role: Person["role"];
  tone: Tone;
  workspace: string;
  href: string | null;
  can: string;
  provisioning: string;
}[] = [
  {
    role: "manager",
    tone: "info",
    workspace: "/manager",
    href: "/manager/home",
    can: "Dispatch, fleet, finance, audit and access review.",
    provisioning: "Trusted administrative process",
  },
  {
    role: "driver",
    tone: "success",
    workspace: "/rider",
    href: null,
    can: "Own assigned parcels, route progress and location sharing.",
    provisioning: "Trusted administrative process",
  },
  {
    role: "seller",
    tone: "muted",
    workspace: "/seller",
    href: null,
    can: "Delivery requests, channels and imported provider orders.",
    provisioning: "Trusted administrative process",
  },
  {
    role: "support",
    tone: "muted",
    workspace: "/support",
    href: null,
    can: "Delivery history and support cases.",
    provisioning: "Trusted administrative process",
  },
  {
    role: "customer",
    tone: "muted",
    workspace: "/",
    href: null,
    can: "Own orders, tracking and payment details.",
    provisioning: "Public sign-up (default role)",
  },
];
const toneOf = (role: string): Tone =>
  ROLES.find((r) => r.role === role)?.tone ?? "muted";

const columns: Column<Person>[] = [
  {
    id: "name",
    header: "Name",
    sortValue: (p) => p.full_name ?? "",
    cell: (p) => p.full_name || <span className="mh-muted">No name</span>,
  },
  {
    id: "role",
    header: "Role",
    nowrap: true,
    sortValue: (p) => p.role,
    cell: (p) => (
      <StatusIndicator tone={toneOf(p.role)}>
        {sentenceCase(p.role)}
      </StatusIndicator>
    ),
  },
  {
    id: "phone",
    header: "Phone",
    nowrap: true,
    cell: (p) => p.phone || <span className="mh-muted">Not set</span>,
  },
  {
    id: "id",
    header: "User ID",
    cell: (p) => <code className="mh-muted">{p.id.slice(0, 8)}</code>,
  },
];

const filters: TableFilter<Person>[] = [
  {
    id: "role",
    label: "Role",
    options: ROLES.map((r) => ({ value: r.role, label: sentenceCase(r.role) })),
    test: (p, v) => p.role === v,
  },
];

export function ManagerAccessApp() {
  const workspace = useWorkspace("manager");
  const ops = useOperationsWorkspace("manager");
  const [authOpen, setAuthOpen] = useState(false);
  const people = ops.data.profiles;
  const loading = workspace.isLoading || ops.isLoading;

  return (
    <ConsoleShell
      active="access"
      workspace={workspace}
      onSignIn={() => setAuthOpen(true)}
    >
      <div className="manager-content">
        <PageHeader
          title="Access & roles"
          description="Who can sign in, what each role can reach, and how accounts are provisioned."
        />
        <RequireManager
          workspace={workspace}
          resource="Access management"
          onSignIn={() => setAuthOpen(true)}
        >
          <div className="mh-page">
            <ResourceTable
              tableId="access"
              title="Accounts"
              description="Roles are enforced by database row-level security, not just by the pages shown."
              items={people}
              rowId={(p) => p.id}
              columns={columns}
              filters={filters}
              searchLabel="Search by name or phone"
              searchText={(p) =>
                `${p.full_name ?? ""} ${p.phone ?? ""} ${p.role}`
              }
              defaultSort={{ column: "name", dir: "asc" }}
              state={loading ? "loading" : ops.error ? "error" : "ready"}
              error={ops.error ?? undefined}
              onRetry={() => void ops.refresh()}
              rowActions={[
                {
                  id: "copy",
                  label: "Copy user ID",
                  onSelect: (p) => void navigator.clipboard?.writeText(p.id),
                },
                {
                  id: "roster",
                  label: "Open team roster",
                  href: () => "/manager/profile",
                  disabled: (p) => p.role !== "driver",
                },
              ]}
              empty={{
                title: "No accounts to show",
                body: "Sign in with a manager account to review accounts.",
              }}
            />
            <Container
              id="roles"
              title="Roles and permissions"
              description="Manager and other staff roles are assigned outside this app, so they cannot be changed here."
            >
              <div className="mh-table-wrap">
                <table className="mh-table">
                  <thead>
                    <tr>
                      <th scope="col">Role</th>
                      <th scope="col">Workspace</th>
                      <th scope="col">Can</th>
                      <th scope="col">How accounts get it</th>
                      <th scope="col" className="mh-num">
                        Accounts
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ROLES.map((r) => (
                      <tr key={r.role}>
                        <th scope="row">
                          <StatusIndicator tone={r.tone}>
                            {sentenceCase(r.role)}
                          </StatusIndicator>
                        </th>
                        <td>
                          {r.href ? (
                            <Link className="mh-link" href={r.href}>
                              {r.workspace}
                            </Link>
                          ) : (
                            <code>{r.workspace}</code>
                          )}
                        </td>
                        <td className="mh-muted">{r.can}</td>
                        <td className="mh-muted">{r.provisioning}</td>
                        <td className="mh-num">
                          {people.filter((p) => p.role === r.role).length}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Container>
          </div>
        </RequireManager>
      </div>
      <AuthDialog
        open={authOpen}
        audience="team"
        onClose={() => setAuthOpen(false)}
      />
    </ConsoleShell>
  );
}
