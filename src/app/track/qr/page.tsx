"use client";

import CheckRounded from "@mui/icons-material/CheckRounded";
import ErrorOutlineRounded from "@mui/icons-material/ErrorOutlineRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { CustomerHeader } from "@/components/delivery/customer-home";
import { PaymentLogo } from "@/components/delivery/payment-logos";
import { sandboxPayOrder } from "@/lib/delivery/actions";
import { currency } from "@/lib/delivery/format";
import {
  downloadQRCode,
  generateMMQRQRCode,
  type MMQRQRCode,
} from "@/lib/delivery/mmqr-sdk";
import { createClient } from "@/lib/supabase/client";

/** Apps that scan an MMQR code. */
const MMQR_APPS = "KBZPay, Wave Pay, AYA Pay, CB Pay or CTZPay";
/** How long the code stays valid. */
const VALID_SECONDS = 15 * 60;
/** Sandbox: how long the QR stays up before the simulated confirmation. */
const SANDBOX_CONFIRM_MS = 4000;

/** Full-height column so the one action can sit at the bottom. */
const SHELL = {
  minHeight: "100dvh",
  display: "flex",
  flexDirection: "column",
} as const;

type Status = "loading" | "ready" | "paid" | "failed";

export default function TrackQrPage() {
  const params = useSearchParams();
  const router = useRouter();
  const code = params.get("code") ?? "";
  const amount = Number(params.get("amount") ?? 0);
  const [qr, setQr] = useState<MMQRQRCode | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [remaining, setRemaining] = useState(VALID_SECONDS);

  useEffect(() => {
    let cancelled = false;
    generateMMQRQRCode({
      merchantId: "oern-merchant",
      amount,
      reference: code,
      merchantName: "Oern",
    })
      .then((result) => {
        if (cancelled) return;
        setQr(result);
        setStatus("ready");
      })
      .catch(() => !cancelled && setStatus("failed"));
    return () => {
      cancelled = true;
    };
  }, [amount, code]);

  useEffect(() => {
    if (status !== "ready") return;
    const timer = window.setInterval(
      () => setRemaining((left) => Math.max(0, left - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [status]);

  // Sandbox: no provider sends a confirmation, so settle the order after the
  // code has been on screen for a moment.
  useEffect(() => {
    if (status !== "ready") return;
    const timer = window.setTimeout(async () => {
      try {
        await sandboxPayOrder(createClient(), code, "mmqr");
        setStatus("paid");
      } catch (cause) {
        console.error("MMQR payment was not confirmed:", cause);
        setStatus("failed");
      }
    }, SANDBOX_CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [status, code]);

  const total = currency.format(amount);
  const clock = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  const back = () => router.back();

  if (status === "paid" || status === "failed") {
    const paid = status === "paid";
    return (
      <Box component="main" className="customer-app" sx={SHELL}>
        <CustomerHeader
          title={paid ? "Payment received" : "Payment not confirmed"}
          isAuthenticated={false}
          unreadCount={0}
          showBell={false}
          onBack={back}
        />
        <Box
          role="status"
          sx={{
            flex: 1,
            px: 2,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            gap: 1,
          }}
        >
          <Box
            sx={{
              width: 64,
              height: 64,
              mb: 1,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              bgcolor: paid ? "#dcfce7" : "#fee2e2",
              color: paid ? "#166534" : "#b91c1c",
            }}
          >
            {paid ? (
              <CheckRounded sx={{ fontSize: 34 }} />
            ) : (
              <ErrorOutlineRounded sx={{ fontSize: 34 }} />
            )}
          </Box>
          <Typography
            sx={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em" }}
          >
            {total}
          </Typography>
          <Typography sx={{ color: "text.secondary" }}>
            {paid
              ? `Paid for ${code}. The rider collects no cash.`
              : "We could not confirm this payment. Nothing was charged."}
          </Typography>
        </Box>
        <BottomAction>
          <Button
            variant="contained"
            size="large"
            fullWidth
            onClick={back}
            sx={{ minHeight: 56 }}
          >
            Back to order
          </Button>
        </BottomAction>
      </Box>
    );
  }

  return (
    <Box component="main" className="customer-app" sx={SHELL}>
      <CustomerHeader
        title="Pay with MMQR"
        subtitle={code}
        isAuthenticated={false}
        unreadCount={0}
        showBell={false}
        onBack={back}
      />
      <Box
        sx={{
          flex: 1,
          px: 2,
          pt: 1,
          display: "grid",
          gap: 2.5,
          alignContent: "start",
        }}
      >
        <Box>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            Amount to pay
          </Typography>
          <Typography
            sx={{
              fontSize: 30,
              lineHeight: "36px",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {total}
          </Typography>
        </Box>

        <Box
          sx={{
            bgcolor: "background.paper",
            border: "1px solid #e2e8f0",
            borderRadius: "16px",
            p: 2.5,
            display: "grid",
            justifyItems: "center",
            gap: 2,
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              alignSelf: "start",
              justifySelf: "start",
            }}
          >
            <PaymentLogo method="mmqr" size={28} />
            <Typography sx={{ fontWeight: 700 }}>Oern</Typography>
          </Box>
          <Box
            aria-busy={status === "loading"}
            sx={{
              width: 240,
              height: 240,
              borderRadius: "12px",
              bgcolor: qr ? "transparent" : "#f1f5f9",
            }}
          >
            {qr && (
              <Image
                src={qr.dataUrl}
                alt={`MMQR code to pay ${total}`}
                width={240}
                height={240}
                unoptimized
                style={{ display: "block", width: 240, height: 240 }}
              />
            )}
          </Box>
          <Typography
            variant="body2"
            sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums" }}
          >
            {qr ? `Expires in ${clock}` : "Preparing your code…"}
          </Typography>
        </Box>

        <Typography
          variant="body2"
          sx={{ color: "text.secondary", textAlign: "center", px: 1 }}
        >
          Open {MMQR_APPS} and scan this code. This screen updates once the
          payment arrives.
        </Typography>
      </Box>
      <BottomAction>
        <Button
          variant="outlined"
          color="secondary"
          size="large"
          fullWidth
          disabled={!qr}
          onClick={() => qr && downloadQRCode(qr, `mmqr-${code}.png`)}
          sx={{ minHeight: 56 }}
        >
          Save QR
        </Button>
      </BottomAction>
    </Box>
  );
}

/** The one action, anchored where the thumb is. */
function BottomAction({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        position: "sticky",
        bottom: 0,
        px: 2,
        pt: 1.5,
        pb: "calc(env(safe-area-inset-bottom) + 16px)",
        bgcolor: "background.default",
      }}
    >
      {children}
    </Box>
  );
}
