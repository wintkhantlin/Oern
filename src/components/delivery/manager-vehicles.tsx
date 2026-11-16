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
import type { VehicleOption } from "@/lib/delivery/types";
import { useWorkspace } from "@/lib/delivery/use-workspace";

export const VEHICLE_STATUS: Record<string, { label: string; tone: Tone }> = {
  available: { label: "Available", tone: "success" },
  in_use: { label: "On route", tone: "info" },
  maintenance: { label: "In service", tone: "warning" },
  inactive: { label: "Inactive", tone: "muted" },
};

const km = new Intl.NumberFormat("en-US");

export const energyLevel = (v: VehicleOption) =>
  v.energy_source === "electric"
    ? v.battery_level_percent
    : v.fuel_level_percent;

/** Kilometres until service, negative when overdue, null when not tracked. */
export const serviceRemaining = (v: VehicleOption) =>
  v.service_due_at_km == null ? null : v.service_due_at_km - v.odometer_km;

export function ServiceCell({ vehicle }: { vehicle: VehicleOption }) {
  const left = serviceRemaining(vehicle);
  if (left == null) return <span className="mh-muted">Not tracked</span>;
  if (left < 0)
    return (
      <StatusIndicator tone="error">
        Overdue {km.format(-left)} km
      </StatusIndicator>
    );
  if (left < 500)
    return (
      <StatusIndicator tone="warning">
        Due in {km.format(left)} km
      </StatusIndicator>
    );
  return <span>{km.format(left)} km left</span>;
}

const columns: Column<VehicleOption>[] = [
  {
    id: "registration",
    header: "Registration",
    sortValue: (v) => v.registration_number,
    cell: (v) => (
      <Link className="mh-link" href={`/manager/vehicles/${v.id}`}>
        {v.registration_number}
      </Link>
    ),
    nowrap: true,
  },
  {
    id: "type",
    header: "Type",
    sortValue: (v) => v.vehicle_type,
    cell: (v) => sentenceCase(v.vehicle_type),
  },
  {
    id: "status",
    header: "Status",
    sortValue: (v) => VEHICLE_STATUS[v.status]?.label ?? v.status,
    nowrap: true,
    cell: (v) => {
      const s = VEHICLE_STATUS[v.status] ?? {
        label: sentenceCase(v.status),
        tone: "muted" as Tone,
      };
      return <StatusIndicator tone={s.tone}>{s.label}</StatusIndicator>;
    },
  },
  {
    id: "capacity",
    header: "Capacity",
    align: "right",
    sortValue: (v) => v.capacity_kg,
    cell: (v) => (v.capacity_kg ? `${km.format(v.capacity_kg)} kg` : "Not set"),
  },
  {
    id: "energy",
    header: "Energy",
    sortValue: (v) => energyLevel(v),
    nowrap: true,
    cell: (v) => {
      const level = energyLevel(v);
      return level == null
        ? `${sentenceCase(v.energy_source)}, not recorded`
        : `${sentenceCase(v.energy_source)}, ${Math.round(level)}%`;
    },
  },
  {
    id: "odometer",
    header: "Odometer",
    align: "right",
    sortValue: (v) => v.odometer_km,
    cell: (v) => `${km.format(v.odometer_km)} km`,
  },
  {
    id: "service",
    header: "Service",
    sortValue: (v) => serviceRemaining(v),
    nowrap: true,
    cell: (v) => <ServiceCell vehicle={v} />,
  },
];

const filters: TableFilter<VehicleOption>[] = [
  {
    id: "status",
    label: "Status",
    options: Object.entries(VEHICLE_STATUS).map(([value, s]) => ({
      value,
      label: s.label,
    })),
    test: (v, value) => v.status === value,
  },
  {
    id: "energy",
    label: "Energy",
    options: [
      { value: "fuel", label: "Fuel" },
      { value: "electric", label: "Electric" },
      { value: "hybrid", label: "Hybrid" },
    ],
    test: (v, value) => v.energy_source === value,
  },
];

export function ManagerVehiclesApp() {
  const workspace = useWorkspace("manager");
  const [authOpen, setAuthOpen] = useState(false);
  const vehicles = workspace.data.vehicles;
  const count = (status: string) =>
    vehicles.filter((v) => v.status === status).length;
  const overdue = vehicles.filter((v) => (serviceRemaining(v) ?? 1) < 0).length;

  const metrics: { label: string; value: number; tone: Tone; hint: string }[] =
    [
      {
        label: "Available",
        value: count("available"),
        tone: "success",
        hint: "Ready to dispatch",
      },
      {
        label: "On route",
        value: count("in_use"),
        tone: "info",
        hint: "Currently delivering",
      },
      {
        label: "In service",
        value: count("maintenance"),
        tone: "warning",
        hint: "Not dispatchable",
      },
      {
        label: "Service overdue",
        value: overdue,
        tone: overdue ? "error" : "success",
        hint: overdue ? "Past service distance" : "None overdue",
      },
    ];

  return (
    <ConsoleShell
      active="vehicles"
      workspace={workspace}
      onSignIn={() => setAuthOpen(true)}
    >
      <div className="manager-content">
        <PageHeader
          title="Vehicles"
          description="Fleet status, energy and service. Open a vehicle to monitor or configure it."
        />
        <RequireManager
          workspace={workspace}
          resource="Fleet records"
          onSignIn={() => setAuthOpen(true)}
        >
          <div className="mh-page">
            <Container id="veh-summary" title="Fleet summary">
              <ul className="mh-metrics">
                {metrics.map((m) => (
                  <li key={m.label}>
                    <div>
                      <span className="mh-metric-label">{m.label}</span>
                      <strong className={`is-${m.tone}`}>{m.value}</strong>
                      <StatusIndicator tone={m.tone}>{m.hint}</StatusIndicator>
                    </div>
                  </li>
                ))}
              </ul>
            </Container>
            <ResourceTable
              tableId="vehicles"
              title="Vehicles"
              description="Search, filter and sort the fleet."
              items={vehicles}
              rowId={(v) => v.id}
              columns={columns}
              filters={filters}
              searchLabel="Search by registration or type"
              searchText={(v) => `${v.registration_number} ${v.vehicle_type}`}
              defaultSort={{ column: "registration", dir: "asc" }}
              state={workspace.error && !vehicles.length ? "error" : "ready"}
              error={workspace.error ?? undefined}
              onRetry={() => void workspace.refresh()}
              rowActions={[
                {
                  id: "open",
                  label: "Open details",
                  href: (v) => `/manager/vehicles/${v.id}`,
                },
                {
                  id: "configure",
                  label: "Configure",
                  href: (v) => `/manager/vehicles/${v.id}#configuration`,
                },
                {
                  id: "copy",
                  label: "Copy registration",
                  onSelect: (v) =>
                    void navigator.clipboard?.writeText(v.registration_number),
                },
              ]}
              empty={{
                title: "No vehicles yet",
                body: "Vehicles added to the fleet appear here.",
              }}
            />
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
