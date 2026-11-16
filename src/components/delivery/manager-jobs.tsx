"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";

import { ConsoleShell } from "@/components/console/console-shell";
import { AuthDialog } from "@/components/delivery/auth-dialog";
import {
  ActionToast,
  LoadingBlock,
  PageHeader,
  SignInGate,
} from "@/components/delivery/common";
import { Icon } from "@/components/delivery/icons";
import { currency, formatDateTime } from "@/lib/delivery/format";
import {
  confirmOrders,
  createJobBatch,
  type DeliveryJob,
  isSampleJob,
  loadJobs,
  loadQueue,
  type QueueEntry,
  releaseJob,
  SAMPLE_OPEN_JOBS,
} from "@/lib/delivery/jobs";
import "./manager-jobs.css";
import { useWorkspace } from "@/lib/delivery/use-workspace";
import { createClient } from "@/lib/supabase/client";

function friendly(cause: unknown) {
  return cause instanceof Error ? cause.message : "Something went wrong.";
}

const BOARD_COLUMNS = [
  { status: "open", title: "Open", hint: "Waiting for a driver" },
  { status: "claimed", title: "Taken", hint: "Driver assigned" },
  { status: "in_progress", title: "On the road", hint: "Route started" },
  { status: "completed", title: "Done", hint: "Latest finished" },
] as const;

const DONE_LIMIT = 5;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function ManagerJobsApp() {
  const workspace = useWorkspace("manager");
  const live = workspace.isAuthenticated && workspace.canUseLiveData;
  const [authOpen, setAuthOpen] = useState(false);
  const [jobs, setJobs] = useState<DeliveryJob[]>([]);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const supabase = createClient();
    try {
      const [nextJobs, nextQueue] = await Promise.all([
        loadJobs(supabase),
        loadQueue(supabase),
      ]);
      setJobs(nextJobs);
      setQueue(nextQueue);
      setError(null);
    } catch (cause) {
      setError(friendly(cause));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!live) {
      setLoaded(true);
      return;
    }
    void reload();
    const supabase = createClient();
    const channel = supabase.channel("manager-jobs");
    for (const table of ["delivery_jobs", "delivery_queue"]) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => void reload(),
      );
    }
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [live, reload]);

  const queuedIds = useMemo(
    () => new Set(queue.map((entry) => entry.order_id)),
    [queue],
  );
  // Live requests drive the bulk actions; sample rows are display-only.
  const liveRequests = useMemo(
    () =>
      workspace.data.orders.filter(
        (order) => order.status === "pending" && !queuedIds.has(order.id),
      ),
    [workspace.data.orders, queuedIds],
  );
  const waiting = queue.filter((entry) => !entry.job_id);
  // Demo mode has no jobs table behind it, so show the sample tasks instead.
  const tasks = useMemo(
    () => (workspace.isDemo ? SAMPLE_OPEN_JOBS : jobs),
    [workspace.isDemo, jobs],
  );
  const activeTasks = useMemo(
    () =>
      tasks.filter((job) =>
        ["open", "claimed", "in_progress"].includes(job.status),
      ),
    [tasks],
  );
  const activeTaskCount = activeTasks.length;
  const driverName = (id: string | null) =>
    id
      ? (workspace.data.drivers.find((driver) => driver.id === id)?.full_name ??
        "Driver")
      : null;

  /** Resolves true when the action succeeded. */
  async function run(action: () => Promise<string>) {
    if (busy) return false;
    if (!live) {
      setMessage("Sign in with a manager account to change jobs.");
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      setMessage(await action());
      await reload();
      return true;
    } catch (cause) {
      setError(friendly(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const post = (ids: string[]) =>
    run(async () => {
      const result = await confirmOrders(createClient(), ids);
      if (!result.confirmed) return "Nothing to post.";
      return `${plural(result.confirmed, "order")} posted as ${plural(result.jobs, "job")} on the driver board.`;
    });

  const groupWaiting = () =>
    run(async () => {
      const result = await createJobBatch(createClient());
      return result.jobs
        ? `Grouped ${plural(result.orders, "order")} into ${plural(result.jobs, "job")}.`
        : "Nothing is waiting in the queue.";
    });

  const reopen = (id: string) =>
    run(async () => {
      await releaseJob(createClient(), id);
      return "Task reopened for other drivers.";
    });

  // Always on: new requests are queued, grouped by area and posted without
  // anyone clicking. A batch that fails is not retried until the set of
  // orders changes or the page is reloaded.
  const failedBatch = useRef<string | null>(null);
  const autoKey = `${liveRequests.map((order) => order.id).join(",")}|${waiting.map((entry) => entry.order_id).join(",")}`;
  const runAutomation = useEffectEvent(async () => {
    if (liveRequests.length) {
      const ok = await post(liveRequests.map((order) => order.id));
      if (!ok) failedBatch.current = autoKey;
    } else if (waiting.length) {
      const ok = await groupWaiting();
      if (!ok) failedBatch.current = autoKey;
    }
  });
  useEffect(() => {
    if (!live || !loaded || busy || failedBatch.current === autoKey) return;
    void runAutomation();
  }, [live, loaded, busy, autoKey]);

  if (workspace.isLoading) return <LoadingBlock title="Opening jobs…" />;
  const signedOut = !workspace.isAuthenticated && !workspace.isDemo;

  return (
    <ConsoleShell
      active="jobs"
      pageTitle="Jobs"
      workspace={workspace}
      onSignIn={() => setAuthOpen(true)}
      className="jobs-app"
      toolbar={
        <button
          type="button"
          className="console-icon-btn"
          aria-label={busy ? "Refreshing jobs" : "Refresh jobs"}
          onClick={() => void reload()}
          disabled={!live || busy}
        >
          <Icon name="refresh" size={16} />
        </button>
      }
    >
      <div className="manager-content">
        <PageHeader
          title="Jobs"
          description="Follow driver jobs from open assignment through completion."
        />
        {(error || workspace.error) && (
          <div className="error-notice" role="alert">
            {error ?? workspace.error}
          </div>
        )}

        {signedOut ? (
          <SignInGate
            title="Sign in to jobs"
            body="The live job board is available to manager accounts."
            onSignIn={() => setAuthOpen(true)}
          />
        ) : !loaded ? (
          <LoadingBlock title="Loading jobs…" />
        ) : (
          <section className="jobs-board" aria-labelledby="jobs-tasks">
            <header className="jobs-stage-head">
              <h2 id="jobs-tasks">
                Job board{" "}
                <span className="mh-card-count">
                  ({activeTaskCount} active)
                </span>
              </h2>
            </header>
            <div className="jobs-board-columns">
              {BOARD_COLUMNS.map((column) => {
                const all = tasks.filter((job) => job.status === column.status);
                const shown =
                  column.status === "completed"
                    ? all.slice(0, DONE_LIMIT)
                    : all;
                return (
                  <div
                    className="jobs-board-column"
                    data-status={column.status}
                    key={column.status}
                  >
                    <h3>
                      {column.title}{" "}
                      <span className="mh-card-count">({all.length})</span>
                    </h3>
                    <ul>
                      {shown.map((job) => {
                        const driver = driverName(job.claimed_by);
                        return (
                          <li className="task-card" key={job.id}>
                            <strong>{job.label}</strong>
                            <span>
                              {plural(job.order_count, "parcel")},{" "}
                              {job.total_weight_kg} kg
                              {job.cod_total
                                ? `, COD ${currency.format(job.cod_total)}`
                                : ""}
                            </span>
                            {job.area_label && <span>{job.area_label}</span>}
                            <span>
                              {driver
                                ? `${driver}, since ${formatDateTime(job.claimed_at ?? job.created_at)}`
                                : `Posted ${formatDateTime(job.created_at)}`}
                            </span>
                            {job.status === "claimed" && (
                              <button
                                type="button"
                                className="button button-outline"
                                disabled={!live || busy || isSampleJob(job)}
                                aria-label={`Reopen ${job.label} for other drivers`}
                                onClick={() => void reopen(job.id)}
                              >
                                Reopen
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {!all.length && (
                      <p className="jobs-board-empty">{column.hint}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      <AuthDialog
        open={authOpen}
        audience="team"
        onClose={() => setAuthOpen(false)}
      />
      <ActionToast message={message} onDismiss={() => setMessage(null)} />
    </ConsoleShell>
  );
}
