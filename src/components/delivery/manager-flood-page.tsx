"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ConsoleShell } from "@/components/console/console-shell";
import { AuthDialog } from "@/components/delivery/auth-dialog";
import {
  LoadingBlock,
  PageHeader,
  SignInGate,
} from "@/components/delivery/common";
import { Icon } from "@/components/delivery/icons";
import type { FloodPoint } from "@/components/delivery/manager-flood-map";
import { FloodWatch } from "@/components/delivery/manager-flood-watch";
import { getYangonFloodZones } from "@/lib/delivery/flood-zones";
import {
  type DeliveryJob,
  loadJobs,
  loadQueue,
  type QueueEntry,
  SAMPLE_OPEN_JOBS,
} from "@/lib/delivery/jobs";
import { useWorkspace } from "@/lib/delivery/use-workspace";
import { createClient } from "@/lib/supabase/client";

function friendly(cause: unknown) {
  return cause instanceof Error ? cause.message : "Something went wrong.";
}

export function ManagerFloodWatchApp() {
  const workspace = useWorkspace("manager");
  const live = workspace.isAuthenticated && workspace.canUseLiveData;
  const [authOpen, setAuthOpen] = useState(false);
  const [jobs, setJobs] = useState<DeliveryJob[]>([]);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reloadRequestId = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++reloadRequestId.current;
    if (!live) {
      setLoaded(true);
      setRefreshing(false);
      return;
    }
    setRefreshing(true);
    try {
      const supabase = createClient();
      const [nextJobs, nextQueue] = await Promise.all([
        loadJobs(supabase),
        loadQueue(supabase),
      ]);
      if (requestId !== reloadRequestId.current) return;
      setJobs(nextJobs);
      setQueue(nextQueue);
      setError(null);
    } catch (cause) {
      if (requestId === reloadRequestId.current) {
        setError(friendly(cause));
      }
    } finally {
      if (requestId === reloadRequestId.current) {
        setLoaded(true);
        setRefreshing(false);
      }
    }
  }, [live]);

  useEffect(() => {
    void reload();
    if (!live) return;

    const supabase = createClient();
    const channel = supabase.channel("manager-flood-watch");
    for (const table of ["delivery_jobs", "delivery_queue"]) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => void reload(),
      );
    }
    channel.subscribe();
    return () => {
      reloadRequestId.current += 1;
      void supabase.removeChannel(channel);
    };
  }, [live, reload]);

  const tasks = useMemo(
    () => (workspace.isDemo ? SAMPLE_OPEN_JOBS : jobs),
    [workspace.isDemo, jobs],
  );
  const queuedIds = useMemo(
    () => new Set(queue.map((entry) => entry.order_id)),
    [queue],
  );
  const coverage = useMemo(() => {
    const points: FloodPoint[] = [];
    let unmappedCount = 0;
    const requests = workspace.data.orders.filter(
      (order) => order.status === "pending" && !queuedIds.has(order.id),
    );
    const activeTasks = tasks.filter((job) =>
      ["open", "claimed", "in_progress"].includes(job.status),
    );

    for (const order of requests) {
      if (
        order.delivery_latitude == null ||
        order.delivery_longitude == null ||
        !Number.isFinite(order.delivery_latitude) ||
        !Number.isFinite(order.delivery_longitude)
      ) {
        unmappedCount += 1;
        continue;
      }
      points.push({
        id: order.id,
        label: `Request ${order.tracking_code}`,
        latitude: order.delivery_latitude,
        longitude: order.delivery_longitude,
        kind: "request",
      });
    }

    for (const job of activeTasks) {
      if (
        job.center_latitude == null ||
        job.center_longitude == null ||
        !Number.isFinite(job.center_latitude) ||
        !Number.isFinite(job.center_longitude)
      ) {
        unmappedCount += 1;
        continue;
      }
      points.push({
        id: job.id,
        label: job.label,
        latitude: job.center_latitude,
        longitude: job.center_longitude,
        kind: "task",
      });
    }

    return { points, unmappedCount };
  }, [queuedIds, tasks, workspace.data.orders]);
  const zones = useMemo(() => getYangonFloodZones(), []);
  const signedOut = !workspace.isAuthenticated && !workspace.isDemo;

  if (workspace.isLoading) {
    return <LoadingBlock title="Opening flood watch…" />;
  }

  return (
    <ConsoleShell
      active="flood"
      pageTitle="Flood watch"
      workspace={workspace}
      onSignIn={() => setAuthOpen(true)}
      className="flood-watch-app"
      toolbar={
        <button
          type="button"
          className="console-icon-btn"
          aria-label={
            refreshing ? "Refreshing flood data" : "Refresh flood data"
          }
          onClick={() => void reload()}
          disabled={!live || refreshing}
        >
          <Icon name="refresh" size={16} />
        </button>
      }
    >
      <div className="manager-content">
        <PageHeader
          title="Flood watch"
          description="Review current Yangon conditions, mapped risk zones, and exposed dispatch stops."
        />
        {(error || workspace.error) && (
          <div className="error-notice" role="alert">
            {error ?? workspace.error}
          </div>
        )}

        {signedOut ? (
          <SignInGate
            title="Sign in to flood watch"
            body="Flood exposure for live requests and jobs is available to manager accounts."
            onSignIn={() => setAuthOpen(true)}
          />
        ) : !loaded ? (
          <LoadingBlock title="Loading flood exposure…" />
        ) : (
          <FloodWatch
            zones={zones}
            points={coverage.points}
            unmappedCount={coverage.unmappedCount}
          />
        )}
      </div>

      <AuthDialog
        open={authOpen}
        audience="team"
        onClose={() => setAuthOpen(false)}
      />
    </ConsoleShell>
  );
}
