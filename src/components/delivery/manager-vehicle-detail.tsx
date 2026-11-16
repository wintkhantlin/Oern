"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import { RequireManager } from "@/components/console/access-gate";
import { ConsoleShell } from "@/components/console/console-shell";
import { StateBlock } from "@/components/console/states";
import { useUnsavedChangesGuard } from "@/components/console/use-unsaved-changes";
import { AuthDialog } from "@/components/delivery/auth-dialog";
import { PageHeader } from "@/components/delivery/common";
import {
  Container,
  StatusIndicator,
  type Tone,
} from "@/components/delivery/manager-home-view";
import {
  energyLevel,
  ServiceCell,
  VEHICLE_STATUS,
} from "@/components/delivery/manager-vehicles";
import { currency, formatDateTime, sentenceCase } from "@/lib/delivery/format";
import { configureVehicleReadiness } from "@/lib/delivery/operations-actions";
import { useOperationsWorkspace } from "@/lib/delivery/use-operations-workspace";
import { useWorkspace } from "@/lib/delivery/use-workspace";
import { createClient } from "@/lib/supabase/client";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "monitoring", label: "Monitoring" },
  { id: "configuration", label: "Configuration" },
  { id: "activity", label: "Activity" },
] as const;
type TabId = (typeof TABS)[number]["id"];
const km = new Intl.NumberFormat("en-US");
const TERMINAL = ["delivered", "failed", "cancelled"];

type FormState = {
  energySource: "fuel" | "electric" | "hybrid";
  level: string;
  rangeKm: string;
  reserve: string;
  odometer: string;
  serviceDue: string;
};

function validate(form: FormState) {
  const errors: Partial<Record<keyof FormState, string>> = {};
  const num = (value: string) =>
    value.trim() === "" ? Number.NaN : Number(value);
  const inRange = (value: string, min: number, max: number) => {
    const n = num(value);
    return Number.isFinite(n) && n >= min && n <= max;
  };
  if (!inRange(form.level, 0, 100))
    errors.level = "Enter a level from 0 to 100.";
  if (!(num(form.rangeKm) > 0))
    errors.rangeKm = "Enter a range greater than 0 km.";
  if (!inRange(form.reserve, 0, 100))
    errors.reserve = "Enter a reserve from 0 to 100.";
  if (!(num(form.odometer) >= 0))
    errors.odometer = "Enter 0 or more kilometres.";
  if (form.serviceDue.trim() !== "" && !(num(form.serviceDue) >= 0))
    errors.serviceDue = "Enter 0 or more kilometres, or leave blank.";
  return errors;
}

export function ManagerVehicleDetail({ id }: { id: string }) {
  const workspace = useWorkspace("manager");
  const ops = useOperationsWorkspace("manager");
  const [authOpen, setAuthOpen] = useState(false);
  const [tab, setTab] = useState<TabId>("overview");

  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash.slice(1);
      if (TABS.some((t) => t.id === hash)) setTab(hash as TabId);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const choose = (next: TabId) => {
    setTab(next);
    window.history.replaceState(null, "", `#${next}`);
  };

  const vehicle = workspace.data.vehicles.find((v) => v.id === id) ?? null;
  const loading = workspace.isLoading || ops.isLoading;
  const registration = vehicle?.registration_number ?? "Vehicle";
  const status = vehicle
    ? (VEHICLE_STATUS[vehicle.status] ?? {
        label: sentenceCase(vehicle.status),
        tone: "muted" as Tone,
      })
    : null;

  const orders = useMemo(
    () => workspace.data.orders.filter((o) => o.vehicle_id === id),
    [workspace.data.orders, id],
  );
  const active = orders.filter((o) => !TERMINAL.includes(o.status));
  const maintenance = ops.data.maintenanceRecords.filter(
    (m) => m.vehicle_id === id,
  );

  /* ---- configuration form ---- */
  const initial = useMemo<FormState | null>(
    () =>
      vehicle && {
        energySource: vehicle.energy_source,
        level: String(energyLevel(vehicle) ?? ""),
        rangeKm: String(vehicle.range_km_at_full ?? ""),
        reserve: String(vehicle.reserve_percent),
        odometer: String(vehicle.odometer_km),
        serviceDue:
          vehicle.service_due_at_km == null
            ? ""
            : String(vehicle.service_due_at_km),
      },
    [vehicle],
  );
  const [form, setForm] = useState<FormState | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  useEffect(() => {
    if (initial && !form) setForm(initial);
  }, [initial, form]);
  const current = form ?? initial;
  const dirty = Boolean(
    current && initial && JSON.stringify(current) !== JSON.stringify(initial),
  );
  useUnsavedChangesGuard(dirty);
  const errors = current ? validate(current) : {};
  const set = (patch: Partial<FormState>) => {
    setForm((f) => ({ ...(f ?? (initial as FormState)), ...patch }));
    setResult(null);
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!current || !vehicle || Object.keys(errors).length) return;
    if (workspace.isDemo) {
      setResult({
        tone: "error",
        text: "Sign in with a manager account to save changes.",
      });
      return;
    }
    setSaving(true);
    try {
      const level = Number(current.level);
      await configureVehicleReadiness(createClient(), {
        vehicleId: vehicle.id,
        energySource: current.energySource,
        fuelLevel:
          current.energySource === "electric"
            ? vehicle.fuel_level_percent
            : level,
        batteryLevel:
          current.energySource === "fuel"
            ? vehicle.battery_level_percent
            : level,
        rangeKmAtFull: Number(current.rangeKm),
        reservePercent: Number(current.reserve),
        odometerKm: Number(current.odometer),
        serviceDueAtKm:
          current.serviceDue.trim() === "" ? null : Number(current.serviceDue),
      });
      await workspace.refresh();
      setForm(null);
      setTouched(false);
      setResult({ tone: "success", text: "Configuration saved." });
    } catch (cause) {
      setResult({
        tone: "error",
        text: cause instanceof Error ? cause.message : "Could not save.",
      });
    } finally {
      setSaving(false);
    }
  }

  const level = vehicle ? energyLevel(vehicle) : null;
  const estRange =
    vehicle && level != null && vehicle.range_km_at_full
      ? (vehicle.range_km_at_full * level) / 100
      : null;
  const usable =
    estRange != null && vehicle
      ? Math.max(
          0,
          estRange -
            (vehicle.range_km_at_full ?? 0) * (vehicle.reserve_percent / 100),
        )
      : null;
  const energyTone: Tone =
    vehicle && level != null
      ? level <= vehicle.reserve_percent
        ? "error"
        : level <= vehicle.reserve_percent + 15
          ? "warning"
          : "success"
      : "muted";

  const field = (
    key: keyof FormState,
    label: string,
    hint: string,
    props: { type?: string; step?: string } = {},
  ) => (
    <label
      className="console-field"
      data-invalid={touched && Boolean(errors[key])}
    >
      {label}
      <input
        type={props.type ?? "number"}
        step={props.step ?? "any"}
        inputMode="decimal"
        value={current?.[key] ?? ""}
        aria-invalid={touched && Boolean(errors[key])}
        aria-describedby={`${key}-hint`}
        onChange={(e) => set({ [key]: e.target.value } as Partial<FormState>)}
      />
      {touched && errors[key] ? (
        <small id={`${key}-hint`} className="console-error" role="alert">
          {errors[key]}
        </small>
      ) : (
        <small id={`${key}-hint`}>{hint}</small>
      )}
    </label>
  );

  return (
    <ConsoleShell
      active="vehicles"
      workspace={workspace}
      onSignIn={() => setAuthOpen(true)}
      crumbs={[{ label: "Vehicles", href: "/manager/vehicles" }]}
      pageTitle={registration}
    >
      <div className="manager-content">
        <RequireManager
          workspace={workspace}
          resource="Vehicle records"
          onSignIn={() => setAuthOpen(true)}
        >
          {loading ? (
            <StateBlock kind="loading" title="Loading vehicle…" />
          ) : !vehicle ? (
            <StateBlock
              kind="empty"
              title="Vehicle not found"
              action={
                <Link
                  className="button button-outline"
                  href="/manager/vehicles"
                >
                  Back to vehicles
                </Link>
              }
            >
              No vehicle with this ID is visible to your account.
            </StateBlock>
          ) : (
            <>
              <PageHeader
                title={vehicle.registration_number}
                description={`${sentenceCase(vehicle.vehicle_type)}, ${vehicle.capacity_kg ? `${km.format(vehicle.capacity_kg)} kg` : "capacity not set"}`}
              />
              <div
                role="tablist"
                aria-label="Vehicle sections"
                className="console-tabs"
              >
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    id={`tab-${t.id}`}
                    aria-selected={tab === t.id}
                    aria-controls={`panel-${t.id}`}
                    tabIndex={tab === t.id ? 0 : -1}
                    onClick={() => choose(t.id)}
                    onKeyDown={(e) => {
                      const i = TABS.findIndex((x) => x.id === tab);
                      const next =
                        e.key === "ArrowRight"
                          ? TABS[(i + 1) % TABS.length]
                          : e.key === "ArrowLeft"
                            ? TABS[(i - 1 + TABS.length) % TABS.length]
                            : null;
                      if (next) {
                        e.preventDefault();
                        choose(next.id);
                        requestAnimationFrame(() =>
                          document.getElementById(`tab-${next.id}`)?.focus(),
                        );
                      }
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div
                role="tabpanel"
                id={`panel-${tab}`}
                aria-labelledby={`tab-${tab}`}
                className="mh-page"
              >
                {tab === "overview" && (
                  <>
                    <Container id="vd-details" title="Details">
                      <dl className="console-kv">
                        <div>
                          <dt>Status</dt>
                          <dd>
                            {status && (
                              <StatusIndicator tone={status.tone}>
                                {status.label}
                              </StatusIndicator>
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Type</dt>
                          <dd>{sentenceCase(vehicle.vehicle_type)}</dd>
                        </div>
                        <div>
                          <dt>Capacity</dt>
                          <dd>
                            {vehicle.capacity_kg
                              ? `${km.format(vehicle.capacity_kg)} kg`
                              : "Not set"}
                          </dd>
                        </div>
                        <div>
                          <dt>Energy source</dt>
                          <dd>{sentenceCase(vehicle.energy_source)}</dd>
                        </div>
                        <div>
                          <dt>Odometer</dt>
                          <dd>{km.format(vehicle.odometer_km)} km</dd>
                        </div>
                        <div>
                          <dt>Service</dt>
                          <dd>
                            <ServiceCell vehicle={vehicle} />
                          </dd>
                        </div>
                      </dl>
                    </Container>
                    <Container
                      id="vd-assign"
                      title="Current deliveries"
                      count={active.length}
                      description="Open orders assigned to this vehicle."
                    >
                      {active.length ? (
                        <div className="mh-table-wrap">
                          <table className="mh-table">
                            <thead>
                              <tr>
                                <th scope="col">Order</th>
                                <th scope="col">Customer</th>
                                <th scope="col">Status</th>
                                <th scope="col">Delivery address</th>
                              </tr>
                            </thead>
                            <tbody>
                              {active.map((o) => (
                                <tr key={o.id}>
                                  <td>
                                    <Link
                                      className="mh-link"
                                      href={`/manager/order?id=${o.id}`}
                                    >
                                      {o.tracking_code}
                                    </Link>
                                  </td>
                                  <td>{o.customer_name}</td>
                                  <td>{sentenceCase(o.status)}</td>
                                  <td className="mh-muted">
                                    {o.delivery_address}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="mh-empty">
                          No open deliveries are assigned to this vehicle.
                        </p>
                      )}
                    </Container>
                  </>
                )}

                {tab === "monitoring" && (
                  <Container
                    id="vd-energy"
                    title="Energy and range"
                    description="From the last recorded level. Update it under Configuration."
                  >
                    {level == null ? (
                      <StateBlock
                        kind="warning"
                        title="Energy level not recorded"
                      >
                        Record a fuel or battery level in Configuration to see
                        range and readiness.
                      </StateBlock>
                    ) : (
                      <div className="console-form">
                        <div>
                          <strong>
                            {sentenceCase(vehicle.energy_source)} level{" "}
                            {Math.round(level)}%
                          </strong>{" "}
                          <StatusIndicator tone={energyTone}>
                            {energyTone === "error"
                              ? "At or below reserve"
                              : energyTone === "warning"
                                ? "Near reserve"
                                : "Above reserve"}
                          </StatusIndicator>
                          <progress
                            className="console-meter"
                            max={100}
                            value={level}
                            aria-label={`Energy level ${Math.round(level)} percent`}
                          />
                        </div>
                        <dl className="console-kv" style={{ padding: 0 }}>
                          <div>
                            <dt>Reserve</dt>
                            <dd>{vehicle.reserve_percent}%</dd>
                          </div>
                          <div>
                            <dt>Range at full</dt>
                            <dd>
                              {vehicle.range_km_at_full
                                ? `${km.format(vehicle.range_km_at_full)} km`
                                : "Not set"}
                            </dd>
                          </div>
                          <div>
                            <dt>Estimated range now</dt>
                            <dd>
                              {estRange != null
                                ? `${km.format(Math.round(estRange))} km`
                                : "Not set"}
                            </dd>
                          </div>
                          <div>
                            <dt>Usable before reserve</dt>
                            <dd>
                              {usable != null
                                ? `${km.format(Math.round(usable))} km`
                                : "Not set"}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    )}
                  </Container>
                )}

                {tab === "configuration" && current && (
                  <Container
                    id="vd-config"
                    title="Readiness settings"
                    description="Used for route energy checks and service reminders."
                  >
                    <form className="console-form" onSubmit={save} noValidate>
                      {result && (
                        <p
                          className="console-notice"
                          data-tone={result.tone}
                          role={result.tone === "error" ? "alert" : "status"}
                        >
                          {result.text}
                        </p>
                      )}
                      <label className="console-field">
                        Energy source
                        <select
                          value={current.energySource}
                          onChange={(e) =>
                            set({
                              energySource: e.target
                                .value as FormState["energySource"],
                            })
                          }
                        >
                          <option value="fuel">Fuel</option>
                          <option value="electric">Electric</option>
                          <option value="hybrid">Hybrid</option>
                        </select>
                      </label>
                      {field(
                        "level",
                        "Current level (%)",
                        "Fuel or battery, 0 to 100",
                      )}
                      {field(
                        "rangeKm",
                        "Range at full (km)",
                        "Distance on a full tank or charge",
                      )}
                      {field(
                        "reserve",
                        "Reserve (%)",
                        "Level at which a refuel or charge stop is needed",
                      )}
                      {field("odometer", "Odometer (km)", "Current reading")}
                      {field(
                        "serviceDue",
                        "Service due at (km)",
                        "Leave blank if not tracked",
                      )}
                      <div className="console-form-actions">
                        <button
                          type="submit"
                          className="button button-primary"
                          disabled={saving || !dirty}
                        >
                          {saving ? "Saving…" : "Save changes"}
                        </button>
                        <button
                          type="button"
                          className="button button-outline"
                          disabled={saving || !dirty}
                          onClick={() => {
                            setForm(null);
                            setTouched(false);
                            setResult(null);
                          }}
                        >
                          Cancel
                        </button>
                        {dirty && <span data-dirty>Unsaved changes</span>}
                      </div>
                    </form>
                  </Container>
                )}

                {tab === "activity" && (
                  <>
                    <Container
                      id="vd-maint"
                      title="Maintenance"
                      count={maintenance.length}
                    >
                      {maintenance.length ? (
                        <div className="mh-table-wrap">
                          <table className="mh-table">
                            <thead>
                              <tr>
                                <th scope="col">Work</th>
                                <th scope="col">Status</th>
                                <th scope="col">Scheduled</th>
                                <th scope="col" className="mh-num">
                                  Cost
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {maintenance.map((m) => (
                                <tr key={m.id}>
                                  <td>
                                    {m.maintenance_type}
                                    {m.notes ? (
                                      <small className="mh-muted">
                                        {" "}
                                        · {m.notes}
                                      </small>
                                    ) : null}
                                  </td>
                                  <td>{sentenceCase(m.status)}</td>
                                  <td>
                                    {m.scheduled_for
                                      ? formatDateTime(m.scheduled_for)
                                      : "Not set"}
                                  </td>
                                  <td className="mh-num">
                                    {currency.format(m.cost_amount)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="mh-empty">
                          No maintenance has been recorded for this vehicle.
                        </p>
                      )}
                    </Container>
                    <Container
                      id="vd-orders"
                      title="Delivery history"
                      count={orders.length}
                    >
                      {orders.length ? (
                        <div className="mh-table-wrap">
                          <table className="mh-table">
                            <thead>
                              <tr>
                                <th scope="col">Order</th>
                                <th scope="col">Customer</th>
                                <th scope="col">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {orders.slice(0, 25).map((o) => (
                                <tr key={o.id}>
                                  <td>
                                    <Link
                                      className="mh-link"
                                      href={`/manager/order?id=${o.id}`}
                                    >
                                      {o.tracking_code}
                                    </Link>
                                  </td>
                                  <td>{o.customer_name}</td>
                                  <td>{sentenceCase(o.status)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="mh-empty">
                          This vehicle has no deliveries yet.
                        </p>
                      )}
                    </Container>
                  </>
                )}
              </div>
            </>
          )}
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
