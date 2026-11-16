import { nearestFoodVendors } from "@/lib/delivery/data/yangon-food-vendors";

/** GET /api/places/vendors?lat=16.8&lng=96.15&limit=5 : nearest pickup suggestions. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const limit = Number(url.searchParams.get("limit") ?? 5);
  if (
    url.searchParams.get("lat") === null ||
    url.searchParams.get("lng") === null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  )
    return Response.json(
      { error: { code: "invalid_request", message: "lat and lng are required" } },
      { status: 400 },
    );
  const results = nearestFoodVendors(lat, lng, Number.isFinite(limit) ? limit : 5);
  return Response.json({
    vendors: results.map(({ vendor, km }) => ({
      id: vendor.id,
      name: vendor.name,
      nativeName: vendor.nativeName,
      category: vendor.category,
      township: vendor.township,
      address: vendor.address,
      latitude: vendor.latitude,
      longitude: vendor.longitude,
      packagingType: vendor.packagingType,
      km: Math.round(km * 100) / 100,
    })),
  });
}
