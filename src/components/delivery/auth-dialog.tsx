"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AuthDialog({
  open,
}: {
  open: boolean;
  onClose: () => void;
  audience?: "customer" | "team";
}) {
  const router = useRouter();

  useEffect(() => {
    if (open)
      router.push(
        `/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
      );
  }, [open, router]);

  return null;
}
