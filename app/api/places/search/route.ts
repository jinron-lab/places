import { AMapPlacesProvider } from "@/lib/providers/amap";

export async function GET(request: Request) {
  const apiKey = process.env.AMAP_WEB_SERVICE_KEY;
  if (!apiKey) return Response.json({ error: "AMap search is not configured" }, { status: 503 });

  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? params.get("query") ?? "").trim();
  const latParam = params.get("lat")?.trim();
  const lngParam = params.get("lng")?.trim();
  const hasLat = Boolean(latParam);
  const hasLng = Boolean(lngParam);
  if (hasLat !== hasLng) return Response.json({ error: "Both latitude and longitude are required when using location search" }, { status: 400 });
  const lat = hasLat ? Number(latParam) : undefined;
  const lng = hasLng ? Number(lngParam) : undefined;
  if ((lat !== undefined && (!Number.isFinite(lat) || lat < -90 || lat > 90)) || (lng !== undefined && (!Number.isFinite(lng) || lng < -180 || lng > 180))) return Response.json({ error: "Invalid search coordinates" }, { status: 400 });
  if (!query) return Response.json({ error: "Search query is required" }, { status: 400 });
  if (query.length > 80) return Response.json({ error: "Search query is too long" }, { status: 400 });

  try {
    const near = lat !== undefined && lng !== undefined ? { lat, lng } : undefined;
    const places = await new AMapPlacesProvider(apiKey).search(query, near, { useDefaultCity: !near });
    return Response.json({ places });
  } catch (error) {
    console.error("AMap POI search failed", error);
    return Response.json({ error: "Place search is temporarily unavailable" }, { status: 502 });
  }
}
