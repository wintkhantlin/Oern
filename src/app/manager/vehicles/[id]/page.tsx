import { Suspense } from "react";

import { ManagerVehicleDetail } from "@/components/delivery/manager-vehicle-detail";

/** Route params are runtime data under Cache Components, so read them inside Suspense. */
async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ManagerVehicleDetail id={id} />;
}

export default function ManagerVehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <Detail params={params} />
    </Suspense>
  );
}
