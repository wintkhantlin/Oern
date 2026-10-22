import type { Metadata } from "next";

import { PickupRequestPage } from "@/components/delivery/pickup-request";

export const metadata: Metadata = {
  title: "Parcel and contacts — Oern",
  description: "Describe your parcel and add pickup and delivery contacts.",
};

export default function PickupDetailsPage() {
  return <PickupRequestPage step="details" />;
}
