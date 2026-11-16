"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { RequireManager } from "@/components/console/access-gate";
import { ConsoleShell } from "@/components/console/console-shell";
import {
  type Column,
  ResourceTable,
  type TableFilter,
} from "@/components/console/resource-table";
import { AuthDialog } from "@/components/delivery/auth-dialog";
import { PageHeader, StatusBadge } from "@/components/delivery/common";
import { formatDateTime } from "@/lib/delivery/format";
import type { DeliveryStatus } from "@/lib/delivery/types";
import { useWorkspace } from "@/lib/delivery/use-workspace";
import { createClient } from "@/lib/supabase/client";

type AuditEvent = {
  id: number;
  order_id: string;
  status: DeliveryStatus;
  changed_by: string | null;
  note: string | null;
  created_at: string;
};
type Actor = { full_name: string | null; role: string };

const STATUSES: DeliveryStatus[] = [
  "pending",
  "assigned",
  "accepted",
  "picked_up",
  "in_transit",
  "delivered",
  "failed",
  "cancelled",
];
const LIMIT = 500;

export function ManagerAuditApp() {
  const workspace = useWorkspace("manager");
  const [authOpen, setAuthOpen] = useState(false);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [actors, setActors] = useState<Map<string, Actor>>(new Map());
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string>();
  const live = workspace.isAuthenticated && workspace.canUseLiveData;

  const load = useCallback(async () => {
    setState("loading");
    try {
      const supabase = createClient();
      const { data, error: queryError } = await supabase
        .from("delivery_status_events")
        .select("id, order_id, status, changed_by, note, created_at")
        .order("created_at", { ascending: false })
        .limit(LIMIT);
      if (queryError) throw new Error(queryError.message);
      const rows = (data ?? []) as AuditEvent[];
      const ids = [
        ...new Set(
          rows.map((r) => r.changed_by).filter((v): v is string => Boolean(v)),
        ),
      ];
      const names = new Map<string, Actor>();
      if (ids.length) {
        const { data: people, error: peopleError } = await supabase
          .from("profiles")
          .select("id, full_name, role")
          .in("id", ids);
        if (peopleError) throw new Error(peopleError.message);
        for (const p of people ?? [])
          names.set(p.id, { full_name: p.full_name, role: p.role });
      }
      setEvents(rows);
      setActors(names);
      setState("ready");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load the audit log.",
      );
      setState("error");
    }
  }, []);

  useEffect(() => {
    if (workspace.isLoading) return;
    if (!live) {
      setState("ready");
      return;
    }
    void load();
  }, [live, workspace.isLoading, load]);

  const orderById = useMemo(
    () => new Map(workspace.data.orders.map((o) => [o.id, o])),
    [workspace.data.orders],
  );
  const actorName = (e: AuditEvent) =>
    e.changed_by
      ? (actors.get(e.changed_by)?.full_name ?? "Unknown user")
      : "System";

  const columns: Column<AuditEvent>[] = [
    {
      id: "time",
      header: "Time",
      nowrap: true,
      sortValue: (e) => e.created_at,
      cell: (e) => formatDateTime(e.created_at),
    },
    {
      id: "order",
      header: "Order",
      nowrap: true,
      sortValue: (e) => orderById.get(e.order_id)?.tracking_code ?? e.order_id,
      cell: (e) => {
        const order = orderById.get(e.order_id);
        return order ? (
          <Link className="mh-link" href={`/manager/order?id=${order.id}`}>
            {order.tracking_code}
          </Link>
        ) : (
          <span className="mh-muted">Not in view</span>
        );
      },
    },
    {
      id: "event",
      header: "Status set",
      nowrap: true,
      sortValue: (e) => e.status,
      cell: (e) => <StatusBadge status={e.status} />,
    },
    {
      id: "actor",
      header: "Changed by",
      sortValue: (e) => actorName(e),
      cell: (e) => (
        <>
          {actorName(e)}
          {e.changed_by && actors.get(e.changed_by) ? (
            <small className="mh-muted">
              {" "}
              · {actors.get(e.changed_by)?.role}
            </small>
          ) : null}
        </>
      ),
    },
    {
      id: "note",
      header: "Note",
      cell: (e) => e.note || <span className="mh-muted">No note</span>,
    },
  ];

  const filters: TableFilter<AuditEvent>[] = [
    {
      id: "status",
      label: "Status set",
      options: STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") })),
      test: (e, v) => e.status === v,
    },
    {
      id: "actor",
      label: "Changed by",
      options: [
        { value: "system", label: "System" },
        { value: "people", label: "People" },
      ],
      test: (e, v) => (v === "system" ? !e.changed_by : Boolean(e.changed_by)),
    },
  ];

  return (
    <ConsoleShell
      active="audit"
      workspace={workspace}
      onSignIn={() => setAuthOpen(true)}
    >
      <div className="manager-content">
        <PageHeader
          title="Audit log"
          description="Every delivery status change, who made it and when."
        />
        <RequireManager
          workspace={workspace}
          resource="The audit log"
          onSignIn={() => setAuthOpen(true)}
        >
          <ResourceTable
            tableId="audit"
            title="Status changes"
            description={`The latest ${LIMIT} changes, newest first.`}
            items={events}
            rowId={(e) => String(e.id)}
            columns={columns}
            filters={filters}
            searchLabel="Search order, person or note"
            searchText={(e) =>
              `${orderById.get(e.order_id)?.tracking_code ?? ""} ${actorName(e)} ${e.note ?? ""}`
            }
            defaultSort={{ column: "time", dir: "desc" }}
            state={workspace.isLoading ? "loading" : state}
            error={error}
            onRetry={() => void load()}
            headerActions={
              <button
                type="button"
                className="button button-outline"
                disabled={!live || state === "loading"}
                onClick={() => void load()}
              >
                Refresh
              </button>
            }
            empty={{
              title: live
                ? "No changes recorded"
                : "Sign in to see the audit log",
              body: live
                ? "Status changes appear here as deliveries move."
                : "No audit records yet.",
            }}
          />
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
