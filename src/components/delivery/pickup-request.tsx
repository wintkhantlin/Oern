"use client";

import CheckCircleOutlined from "@mui/icons-material/CheckCircleOutlined";
import LocationOnOutlined from "@mui/icons-material/LocationOnOutlined";
import MyLocationOutlined from "@mui/icons-material/MyLocationOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { CustomerHeader } from "@/components/delivery/customer-home";
import { createCustomerPickupOrder } from "@/lib/delivery/actions";
import { currency } from "@/lib/delivery/format";
import { reverseGeocode } from "@/lib/delivery/mapbox";
import {
  clearDraft,
  describeParcel,
  emptyDraft,
  isMyanmarPhone,
  loadDraft,
  type PickupDraft,
  parcelKinds,
  parcelSizes,
  saveDraft,
  validatePickup,
} from "@/lib/delivery/pickup-draft";
import { createClient } from "@/lib/supabase/client";

type Step = "route" | "details" | "review";
type Errors = Partial<Record<keyof PickupDraft, string>>;

export function PickupRequestPage({ step = "route" }: { step?: Step }) {
  const router = useRouter();
  const [draft, setDraft] = useState<PickupDraft>(emptyDraft);
  const [ready, setReady] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{
    id: string;
    tracking_code: string;
  } | null>(null);
  const [gps, setGps] = useState(false);
  const inFlight = useRef(false);
  const draftRef = useRef(draft);
  useEffect(() => {
    const restored = loadDraft();
    draftRef.current = restored;
    setDraft(restored);
    setReady(true);
  }, []);

  function update(patch: Partial<PickupDraft>) {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    saveDraft(next);
  }

  function locate() {
    if (!navigator.geolocation) {
      setError(
        "Location is unavailable. Type your pickup address or choose it on the map.",
      );
      return;
    }
    setGps(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const point = {
          latitude: coords.latitude,
          longitude: coords.longitude,
        };
        update({ pickupPoint: point });
        try {
          const address = await reverseGeocode(point);
          if (address && !draftRef.current.pickupAddress.trim())
            update({ pickupAddress: address });
        } finally {
          setGps(false);
        }
      },
      (cause) => {
        setGps(false);
        setError(
          cause.code === cause.PERMISSION_DENIED
            ? "Location permission is blocked. Allow it in browser settings and try again, or type your address."
            : "Couldn’t locate you. Try again or type your address.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || result) return;
    const invalid = validatePickup(draft, step);
    setErrors(invalid);
    setError(null);
    if (Object.keys(invalid).length) {
      setError(
        step === "review"
          ? "Some details are missing. Edit addresses or parcel details below."
          : "Check the highlighted fields.",
      );
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLInputElement>('[aria-invalid="true"]')
          ?.focus(),
      );
      return;
    }
    saveDraft(draft);
    if (step !== "review") {
      router.push(step === "route" ? "/pickup/details" : "/pickup/review");
      return;
    }
    inFlight.current = true;
    setSending(true);
    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.getSession();
      if (authError) throw authError;
      if (!data.session) {
        router.push("/signin?next=%2Fpickup%2Freview");
        return;
      }
      const created = await createCustomerPickupOrder(supabase, {
        pickupAddress: draft.pickupAddress.trim(),
        pickupLatitude: draft.pickupPoint?.latitude,
        pickupLongitude: draft.pickupPoint?.longitude,
        pickupContactPhone: draft.contactPhone.trim(),
        deliveryAddress: draft.deliveryAddress.trim(),
        deliveryLatitude: draft.deliveryPoint?.latitude,
        deliveryLongitude: draft.deliveryPoint?.longitude,
        recipientName: draft.recipientName.trim(),
        recipientPhone: draft.recipientPhone.trim(),
        parcelDescription: describeParcel(draft),
        codAmount: Number(draft.codAmount || 0),
      });
      setResult(created);
      clearDraft();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn’t send your request. Your details are saved; try again.",
      );
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  const back =
    step === "route"
      ? "/home"
      : step === "details"
        ? "/pickup"
        : "/pickup/details";
  const title = result
    ? "Pickup requested"
    : step === "route"
      ? "Pickup addresses"
      : step === "details"
        ? "Parcel and contacts"
        : "Review pickup";
  function field(
    key:
      | "pickupAddress"
      | "deliveryAddress"
      | "contactPhone"
      | "recipientName"
      | "recipientPhone"
      | "parcelDetails"
      | "codAmount"
      | "notes",
    label: string,
    options: {
      multiline?: boolean;
      type?: string;
      required?: boolean;
      autoComplete?: string;
    } = {},
  ) {
    return (
      <TextField
        key={key}
        fullWidth
        label={label}
        value={draft[key]}
        onChange={(event) =>
          update({
            [key]: event.target.value,
            ...(key === "pickupAddress"
              ? { pickupPoint: null }
              : key === "deliveryAddress"
                ? { deliveryPoint: null }
                : {}),
          })
        }
        error={!!errors[key]}
        helperText={errors[key]}
        multiline={options.multiline}
        minRows={options.multiline ? 2 : undefined}
        type={options.type}
        required={options.required}
        autoComplete={options.autoComplete}
        slotProps={{
          htmlInput: {
            maxLength: key === "notes" || key === "parcelDetails" ? 1000 : 500,
            inputMode:
              key === "codAmount"
                ? "decimal"
                : options.type === "tel"
                  ? "tel"
                  : undefined,
          },
        }}
      />
    );
  }
  return (
    <main className="customer-app customer-pickup">
      <CustomerHeader
        title={title}
        isAuthenticated={false}
        unreadCount={0}
        onBack={() => router.push(result ? "/home" : back)}
      />
      {!ready ? (
        <Stack spacing={2} sx={{ p: 2 }} aria-label="Loading pickup draft">
          <Skeleton height={100} />
          <Skeleton height={100} />
          <Skeleton height={56} />
        </Stack>
      ) : result ? (
        <Stack spacing={2} sx={{ px: 2, py: 5 }}>
          <CheckCircleOutlined color="success" sx={{ fontSize: 48 }} />
          <Typography component="h2" variant="h5">
            Request sent
          </Typography>
          <Typography color="text.secondary">
            Your pickup is pending. We’ll show the rider here once your delivery
            is assigned.
          </Typography>
          <Typography sx={{ fontWeight: 700 }}>
            {result.tracking_code}
          </Typography>
          <Button
            component={Link}
            href={
              result.id
                ? `/track?order=${encodeURIComponent(result.id)}`
                : `/track?code=${encodeURIComponent(result.tracking_code)}`
            }
            variant="contained"
          >
            View request
          </Button>
          <Button component={Link} href="/home">
            Back to Home
          </Button>
        </Stack>
      ) : (
        <form onSubmit={submit} noValidate>
          <Stack className="pickup-fields" spacing={2.5}>
            <Stack
              direction="row"
              component="ol"
              aria-label="Pickup steps"
              sx={{ m: 0, p: 0, listStyle: "none", gap: 1 }}
            >
              {(["route", "details", "review"] as const).map((value, index) => (
                <Typography
                  component="li"
                  key={value}
                  aria-current={step === value ? "step" : undefined}
                  variant="caption"
                  sx={{
                    flex: 1,
                    color: step === value ? "primary.main" : "text.secondary",
                    fontWeight: step === value ? 700 : 400,
                    borderBottom: 2,
                    borderColor: step === value ? "primary.main" : "divider",
                    pb: 1,
                  }}
                >
                  {index + 1}. {["Addresses", "Parcel", "Review"][index]}
                </Typography>
              ))}
            </Stack>
            {error && <Alert severity="error">{error}</Alert>}
            {step === "route" && (
              <>
                <Typography color="text.secondary">
                  Where should your rider collect and deliver the parcel?
                </Typography>
                {field("pickupAddress", "Pickup address", {
                  multiline: true,
                  required: true,
                })}
                <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
                  <Button
                    component={Link}
                    href="/pickup/map"
                    startIcon={<LocationOnOutlined />}
                  >
                    Pickup map pin{draft.pickupPoint ? " · Set" : ""}
                  </Button>
                  <Button
                    disabled={gps}
                    onClick={locate}
                    startIcon={<MyLocationOutlined />}
                  >
                    {gps ? "Locating…" : "Use my location"}
                  </Button>
                </Stack>
                {field("deliveryAddress", "Delivery address", {
                  multiline: true,
                  required: true,
                })}
                <Button
                  component={Link}
                  href="/pickup/map/delivery"
                  startIcon={<LocationOnOutlined />}
                  sx={{ alignSelf: "flex-start" }}
                >
                  Delivery map pin{draft.deliveryPoint ? " · Set" : ""}
                </Button>
                <Typography variant="body2" color="text.secondary">
                  Include building, street and township. Map pins are optional.
                </Typography>
              </>
            )}
            {step === "details" && (
              <>
                {field("contactPhone", "Pickup contact phone", {
                  type: "tel",
                  required: true,
                  autoComplete: "tel",
                })}
                {field("recipientName", "Recipient name", { required: true })}
                {field("recipientPhone", "Recipient phone", {
                  type: "tel",
                  required: true,
                })}
                <TextField
                  select
                  fullWidth
                  label="Parcel type"
                  value={draft.parcelKind ?? ""}
                  onChange={(event) =>
                    update({
                      parcelKind: event.target
                        .value as PickupDraft["parcelKind"],
                    })
                  }
                >
                  {parcelKinds.map((kind) => (
                    <MenuItem key={kind} value={kind}>
                      {kind}
                    </MenuItem>
                  ))}
                </TextField>
                {field("parcelDetails", "Parcel description", {
                  multiline: true,
                })}
                <details>
                  <summary
                    style={{
                      minHeight: 48,
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    Size and handling
                  </summary>
                  <Stack spacing={1}>
                    <TextField
                      select
                      fullWidth
                      label="Parcel size"
                      value={draft.parcelSize}
                      onChange={(event) =>
                        update({
                          parcelSize: event.target
                            .value as PickupDraft["parcelSize"],
                        })
                      }
                    >
                      {parcelSizes.map((size) => (
                        <MenuItem key={size.value} value={size.value}>
                          {size.value} · {size.hint}
                        </MenuItem>
                      ))}
                    </TextField>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={draft.fragile}
                          onChange={(_, checked) =>
                            update({ fragile: checked })
                          }
                        />
                      }
                      label="Handle with care — fragile"
                    />
                  </Stack>
                </details>
                {field("codAmount", "Cash to collect (MMK)", { type: "text" })}
                <Typography variant="caption" color="text.secondary">
                  Leave blank or enter 0 if no cash needs collecting.
                </Typography>
                <details>
                  <summary
                    style={{
                      minHeight: 48,
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    Delivery instructions (optional)
                  </summary>
                  {field("notes", "Instructions for the rider", {
                    multiline: true,
                  })}
                </details>
              </>
            )}
            {step === "review" && (
              <>
                <Box>
                  <Stack
                    direction="row"
                    sx={{
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Typography
                      component="h2"
                      variant="subtitle1"
                      sx={{ fontWeight: 700 }}
                    >
                      Door to door
                    </Typography>
                    <Button component={Link} href="/pickup">
                      Edit addresses
                    </Button>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    Pickup
                  </Typography>
                  <Typography sx={{ mb: 2 }}>
                    {draft.pickupAddress || "Address missing"}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Deliver to
                  </Typography>
                  <Typography>
                    {draft.deliveryAddress || "Address missing"}
                  </Typography>
                </Box>
                <Box sx={{ borderTop: 1, borderColor: "divider", pt: 1 }}>
                  <Stack
                    direction="row"
                    sx={{
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Typography
                      component="h2"
                      variant="subtitle1"
                      sx={{ fontWeight: 700 }}
                    >
                      Parcel and contacts
                    </Typography>
                    <Button component={Link} href="/pickup/details">
                      Edit details
                    </Button>
                  </Stack>
                  <Typography>{describeParcel(draft)}</Typography>
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    Pickup contact · {draft.contactPhone || "Missing"}
                  </Typography>
                  <Typography variant="body2">
                    Recipient · {draft.recipientName || "Missing"} ·{" "}
                    {draft.recipientPhone}
                  </Typography>
                </Box>
                <Box sx={{ borderTop: 1, borderColor: "divider", pt: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Cash on delivery
                  </Typography>
                  <Typography sx={{ fontWeight: 700 }}>
                    {Number.isFinite(Number(draft.codAmount))
                      ? currency.format(Number(draft.codAmount || 0))
                      : "Invalid amount"}{" "}
                    to collect
                  </Typography>
                </Box>
                <Typography variant="body2" color="text.secondary">
                  Your request starts as pending. Pickup timing is confirmed
                  after a rider is assigned.
                </Typography>
              </>
            )}
          </Stack>
          <Box className="pickup-dock">
            <Button
              fullWidth
              variant="contained"
              type="submit"
              disabled={sending}
              sx={{ minHeight: 52 }}
            >
              {sending
                ? "Sending request…"
                : step === "route"
                  ? "Continue to parcel details"
                  : step === "details"
                    ? "Review pickup"
                    : "Request pickup"}
            </Button>
          </Box>
        </form>
      )}
    </main>
  );
}
