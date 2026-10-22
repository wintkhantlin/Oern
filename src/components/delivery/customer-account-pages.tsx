"use client";

import ChevronRight from "@mui/icons-material/ChevronRight";
import HelpOutlineRounded from "@mui/icons-material/HelpOutlineRounded";
import HistoryOutlined from "@mui/icons-material/HistoryOutlined";
import LogoutOutlined from "@mui/icons-material/LogoutOutlined";
import NotificationsNone from "@mui/icons-material/NotificationsNone";
import SearchOutlined from "@mui/icons-material/SearchOutlined";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import InputAdornment from "@mui/material/InputAdornment";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusChip } from "@/components/delivery/customer-home";
import { CustomerSheet } from "@/components/delivery/customer-sheet";
import { currency, formatDateTime, timeUntil } from "@/lib/delivery/format";
import { clearDraft } from "@/lib/delivery/pickup-draft";
import type { DeliveryOrder, StatusEvent } from "@/lib/delivery/types";

export type OrderFilter = "all" | "active" | "history" | "delivered" | "issues";
export function matchesOrderFilter(order: DeliveryOrder, filter: OrderFilter) {
  const closed = ["delivered", "failed", "cancelled"].includes(order.status);
  if (filter === "all") return true;
  if (filter === "active") return !closed;
  if (filter === "history") return closed;
  if (filter === "delivered") return order.status === "delivered";
  return order.status === "failed" || order.status === "cancelled";
}

export function OrdersPage({
  orders,
  events = [],
  filter,
  onFilter,
  isAuthenticated,
  onSignIn,
}: {
  orders: DeliveryOrder[];
  events?: StatusEvent[];
  filter: OrderFilter;
  onFilter: (filter: OrderFilter) => void;
  isAuthenticated: boolean;
  onSignIn: () => void;
}) {
  const [query, setQuery] = useState("");
  const history = ["history", "delivered", "issues"].includes(filter);
  useEffect(() => {
    function restore() {
      const params = new URLSearchParams(window.location.search);
      const value = params.get("outcome");
      onFilter(
        params.get("section") === "history"
          ? value === "delivered" || value === "issues"
            ? value
            : "history"
          : "active",
      );
      setQuery(params.get("q") ?? "");
    }
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [onFilter]);
  function update(next: OrderFilter, search = query) {
    onFilter(next);
    setQuery(search);
    const params = new URLSearchParams();
    params.set("section", next === "active" ? "active" : "history");
    if (next === "delivered" || next === "issues") params.set("outcome", next);
    if (search) params.set("q", search);
    window.history.replaceState(window.history.state, "", `/orders?${params}`);
  }
  const terminalTimes = new Map<string, string>();
  for (const event of events) {
    if (
      ["delivered", "failed", "cancelled"].includes(event.status) &&
      event.created_at > (terminalTimes.get(event.order_id) ?? "")
    )
      terminalTimes.set(event.order_id, event.created_at);
  }
  const needle = query.trim().toLowerCase();
  const visible = orders
    .filter(
      (order) =>
        matchesOrderFilter(order, filter) &&
        (!needle ||
          [order.tracking_code, order.delivery_address, order.recipient_name]
            .join(" ")
            .toLowerCase()
            .includes(needle)),
    )
    .sort((a, b) =>
      (history
        ? (terminalTimes.get(b.id) ?? b.created_at)
        : b.created_at
      ).localeCompare(
        history ? (terminalTimes.get(a.id) ?? a.created_at) : a.created_at,
      ),
    );
  const activeCount = orders.filter((order) =>
    matchesOrderFilter(order, "active"),
  ).length;
  return (
    <Box sx={{ px: 2, pb: 3 }}>
      <Stack
        direction="row"
        aria-label="Delivery sections"
        role="group"
        sx={{ p: 0.5, bgcolor: "action.hover", borderRadius: "12px", mb: 2 }}
      >
        {(["active", "history"] as const).map((section) => (
          <Button
            key={section}
            fullWidth
            color="secondary"
            aria-pressed={(section === "history") === history}
            onClick={() => update(section)}
            sx={{
              minHeight: 48,
              borderRadius: "9px",
              bgcolor:
                (section === "history") === history
                  ? "background.paper"
                  : "transparent",
              fontWeight: 700,
            }}
          >
            {section === "active"
              ? `Active${activeCount ? ` · ${activeCount}` : ""}`
              : "History"}
          </Button>
        ))}
      </Stack>
      {orders.length > 0 && (
        <TextField
          fullWidth
          type="search"
          placeholder="Search code or address"
          value={query}
          onChange={(event) => update(filter, event.target.value)}
          slotProps={{
            htmlInput: { "aria-label": "Search deliveries" },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchOutlined />
                </InputAdornment>
              ),
            },
          }}
        />
      )}
      {history && orders.length > 0 && (
        <Stack
          direction="row"
          spacing={1}
          role="group"
          aria-label="History outcome"
          sx={{ mt: 1, overflowX: "auto" }}
        >
          {(
            [
              ["history", "All outcomes"],
              ["delivered", "Delivered"],
              ["issues", "Issues"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              size="small"
              aria-pressed={filter === value}
              onClick={() => update(value)}
              color={filter === value ? "primary" : "secondary"}
              sx={{
                minHeight: 48,
                flexShrink: 0,
                fontWeight: filter === value ? 700 : 400,
              }}
            >
              {label}
            </Button>
          ))}
        </Stack>
      )}
      {!isAuthenticated ? (
        <Stack spacing={1.5} sx={{ py: 5 }}>
          <Typography variant="h6">Sign in to see your orders</Typography>
          <Typography color="text.secondary">
            Your deliveries and history stay linked to your account.
          </Typography>
          <Button variant="contained" onClick={onSignIn}>
            Sign in
          </Button>
        </Stack>
      ) : visible.length === 0 ? (
        <Stack spacing={1.5} sx={{ py: 5 }}>
          <Typography component="h2" variant="h6">
            {needle
              ? "No matching deliveries"
              : history
                ? "No delivery history yet"
                : "No active deliveries"}
          </Typography>
          <Typography color="text.secondary">
            {needle
              ? "Try another code or address."
              : history
                ? "Delivered, cancelled and unsuccessful deliveries appear here."
                : "Request a pickup and follow it from door to door."}
          </Typography>
          {needle ? (
            <Button onClick={() => update(filter, "")}>Clear search</Button>
          ) : (
            !history && (
              <Button component={Link} href="/pickup" variant="contained">
                Request a pickup
              </Button>
            )
          )}
        </Stack>
      ) : (
        <List disablePadding sx={{ mt: 1 }}>
          {visible.map((order) => (
            <Box
              component="li"
              key={order.id}
              sx={{
                borderBottom: 1,
                borderColor: "divider",
                listStyle: "none",
              }}
            >
              <ListItemButton
                component={Link}
                href={`/track?order=${encodeURIComponent(order.id)}`}
                sx={{ px: 0, py: 2, gap: 1, minHeight: 80 }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{
                      alignItems: "center",
                      justifyContent: "space-between",
                      mb: 0.75,
                    }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      {order.tracking_code}
                    </Typography>
                    <StatusChip status={order.status} />
                  </Stack>
                  <Typography
                    sx={{
                      fontWeight: 650,
                      fontSize: 15,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {order.delivery_address}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {history ? "Updated" : "Ordered"}{" "}
                    {formatDateTime(
                      history
                        ? (terminalTimes.get(order.id) ?? order.created_at)
                        : order.created_at,
                    )}
                  </Typography>
                  <Stack sx={{ mt: 0.5 }}>
                    <Typography variant="caption">
                      {["picked_up", "in_transit"].includes(order.status)
                        ? `ETA ${timeUntil(order.estimated_delivery_at)}`
                        : null}
                    </Typography>
                    {order.cod_amount > 0 && (
                      <Typography
                        variant="caption"
                        color={
                          order.cod_status === "pending"
                            ? "warning.dark"
                            : "text.secondary"
                        }
                      >
                        COD {currency.format(order.cod_amount)} ·{" "}
                        {order.cod_status === "pending"
                          ? "Payment due"
                          : "Paid"}
                      </Typography>
                    )}
                  </Stack>
                </Box>
                <ChevronRight sx={{ color: "text.secondary", fontSize: 20 }} />
              </ListItemButton>
            </Box>
          ))}
        </List>
      )}
    </Box>
  );
}

export function ProfilePage({
  name,
  phone,
  isAuthenticated,
  unreadCount,
  onSignIn,
  onSignOut,
  onOpenHelp,
}: {
  name: string | null;
  phone: string | null;
  isAuthenticated: boolean;
  unreadCount: number;
  onSignIn: () => void;
  onSignOut: () => Promise<void>;
  onOpenHelp: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initials = (name || "Customer")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join("")
    .toUpperCase();
  async function leave() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSignOut();
      clearDraft();
    } catch {
      setError("Couldn’t sign out. Check your connection and try again.");
      setBusy(false);
    }
  }
  const rowSx = {
    minHeight: 64,
    px: 0,
    gap: 1.5,
    borderBottom: 1,
    borderColor: "divider",
    "& .MuiListItemText-primary": { fontWeight: 600, fontSize: 15 },
  };
  return (
    <Box sx={{ px: 2, pb: 3 }}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: "center", py: 2, mb: 3 }}
      >
        <Avatar
          sx={{
            width: 56,
            height: 56,
            bgcolor: "action.selected",
            color: "text.primary",
            fontWeight: 700,
            fontSize: 20,
          }}
        >
          {isAuthenticated ? initials : "?"}
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            component="h2"
            variant="h6"
            sx={{ fontWeight: 700, overflowWrap: "anywhere" }}
          >
            {isAuthenticated ? name || "Customer" : "Welcome to Oern"}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {isAuthenticated
              ? phone || "No phone number on file"
              : "Sign in to manage your deliveries."}
          </Typography>
        </Box>
      </Stack>
      {!isAuthenticated && (
        <Button fullWidth variant="contained" onClick={onSignIn} sx={{ mb: 3 }}>
          Sign in
        </Button>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
        Your account
      </Typography>
      <List disablePadding component="nav" aria-label="Account">
        {isAuthenticated && (
          <>
            <ListItemButton
              component={Link}
              href="/orders?section=history"
              sx={rowSx}
            >
              <HistoryOutlined color="action" />
              <ListItemText primary="Delivery history" />
              <ChevronRight color="action" />
            </ListItemButton>
            <ListItemButton component={Link} href="/notifications" sx={rowSx}>
              <NotificationsNone color="action" />
              <ListItemText primary="Notifications" />
              {unreadCount > 0 && (
                <Chip
                  size="small"
                  color="primary"
                  label={unreadCount > 99 ? "99+" : unreadCount}
                  aria-label={`${unreadCount} unread updates`}
                />
              )}
              <ChevronRight color="action" />
            </ListItemButton>
          </>
        )}
        <ListItemButton onClick={onOpenHelp} sx={rowSx}>
          <HelpOutlineRounded color="action" />
          <ListItemText primary="Help and support" />
          <ChevronRight color="action" />
        </ListItemButton>
      </List>
      {isAuthenticated && (
        <Button
          startIcon={<LogoutOutlined />}
          color="error"
          onClick={() => setConfirm(true)}
          sx={{ mt: 3, minHeight: 48, px: 0 }}
        >
          Sign out
        </Button>
      )}
      <CustomerSheet
        open={confirm}
        onClose={() => {
          if (!busy) setConfirm(false);
        }}
        titleId="signout-title"
        title="Sign out of Oern?"
        dock={
          <Stack spacing={1}>
            <Button
              fullWidth
              variant="contained"
              color="error"
              disabled={busy}
              onClick={() => void leave()}
            >
              {busy ? "Signing out…" : "Sign out"}
            </Button>
            <Button
              fullWidth
              color="secondary"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Stay signed in
            </Button>
          </Stack>
        }
      >
        <Typography color="text.secondary">
          Your deliveries are saved to your account. Any unfinished pickup draft
          on this device will be cleared.
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </CustomerSheet>
    </Box>
  );
}
