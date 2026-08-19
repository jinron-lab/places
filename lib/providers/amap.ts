import type { Place, PlaceCategory, PlaceSearchResult, PlacesProviderAdapter } from "@/lib/places";
import { enrichProviderMetadata } from "@/lib/provider-metadata";

const AMAP_SEARCH_URL = "https://restapi.amap.com/v3/place/text";

type AMapText = string | string[];
type AMapPoi = {
  id: string;
  name: string;
  alias?: AMapText;
  type?: string;
  typecode?: string;
  tag?: AMapText;
  address?: AMapText;
  location?: string;
  cityname?: AMapText;
  pname?: AMapText;
  distance?: string;
  tel?: AMapText;
  biz_ext?: { rating?: string; cost?: string } | AMapText;
};
type AMapSearchResponse = { status: "0" | "1"; info: string; infocode: string; pois?: AMapPoi[] };

function text(value?: AMapText) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function number(value?: string) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const ENGLISH_SEARCH_TERMS: Record<string, string> = {
  cafe: "咖啡厅",
  café: "咖啡厅",
  coffee: "咖啡厅",
  "coffee shop": "咖啡厅",
  food: "美食",
  restaurant: "餐厅",
  restaurants: "餐厅",
  museum: "博物馆",
  museums: "博物馆",
  park: "公园",
  parks: "公园",
  landmark: "景点",
  landmarks: "景点",
  attraction: "景点",
  attractions: "景点",
};

function splitText(value?: AMapText) {
  return text(value).split(/[;；|,，]/).map((item) => item.trim()).filter(Boolean);
}

function amapSearchTerm(query: string) {
  return ENGLISH_SEARCH_TERMS[query.trim().toLocaleLowerCase()] ?? query;
}

function categoryFor(poi: AMapPoi): PlaceCategory {
  const label = poi.type ?? "";
  const group = poi.typecode?.slice(0, 2);
  if (label.includes("咖啡") || label.includes("茶艺")) return "coffee";
  if (group === "05") return "restaurant";
  if (group === "14" || label.includes("博物馆") || label.includes("美术馆")) return "museum";
  if (label.includes("公园") || label.includes("风景名胜")) return "park";
  return "landmark";
}

function normalizePoi(poi: AMapPoi): PlaceSearchResult | null {
  if (!poi.id || !poi.name || !poi.location) return null;
  const [lng, lat] = poi.location.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const typeParts = (poi.type ?? "Place").split(";").filter(Boolean);
  const providerCategories = typeParts.map((part, index) => enrichProviderMetadata({ name: part, providerId: index === typeParts.length - 1 ? poi.typecode : undefined }));
  const providerTags = splitText(poi.tag).map((tag) => enrichProviderMetadata({ name: tag }));
  const business = typeof poi.biz_ext === "object" && !Array.isArray(poi.biz_ext) ? poi.biz_ext : undefined;

  return {
    place: {
      id: `amap:${poi.id}`,
      provider: "amap",
      providerPlaceId: poi.id,
      name: poi.name,
      nameLocal: poi.name,
      aliases: splitText(poi.alias),
      category: categoryFor(poi),
      categoryLabel: providerCategories.at(-1)?.name ?? "Place",
      providerCategories,
      providerTags,
      address: text(poi.address) || "Address unavailable",
      city: text(poi.cityname) || text(poi.pname) || "Beijing",
      countryCode: "CN",
      coordinates: { lat, lng },
      providerRating: number(business?.rating),
      phone: text(poi.tel) || undefined,
    },
    distanceMeters: number(poi.distance),
  };
}

function distanceBetween(from: Place["coordinates"], to: Place["coordinates"]) {
  const radians = (value: number) => value * Math.PI / 180;
  const latDelta = radians(to.lat - from.lat);
  const lngDelta = radians(to.lng - from.lng);
  const a = Math.sin(latDelta / 2) ** 2 + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(lngDelta / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export class AMapPlacesProvider implements PlacesProviderAdapter {
  provider = "amap" as const;

  constructor(private readonly apiKey: string) {}

  async search(query: string, near?: Place["coordinates"], options: { useDefaultCity?: boolean } = {}): Promise<PlaceSearchResult[]> {
    const params = new URLSearchParams({
      key: this.apiKey,
      keywords: amapSearchTerm(query),
      city: options.useDefaultCity ? "北京" : "全国",
      citylimit: options.useDefaultCity ? "true" : "false",
      offset: "20",
      page: "1",
      extensions: "all",
    });
    if (near) {
      params.set("location", `${near.lng},${near.lat}`);
      params.set("sortrule", "distance");
    }
    const response = await fetch(`${AMAP_SEARCH_URL}?${params}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`AMap request failed with ${response.status}`);
    const data = (await response.json()) as AMapSearchResponse;
    if (data.status !== "1") throw new Error(`AMap error ${data.infocode}: ${data.info}`);
    return (data.pois ?? [])
      .map(normalizePoi)
      .filter((result): result is PlaceSearchResult => result !== null)
      .map((result) => near ? { ...result, distanceMeters: result.distanceMeters ?? distanceBetween(near, result.place.coordinates) } : result)
      .sort((a, b) => near ? (a.distanceMeters ?? Number.POSITIVE_INFINITY) - (b.distanceMeters ?? Number.POSITIVE_INFINITY) : 0);
  }

  async getPlace(): Promise<Place | null> {
    throw new Error("AMap place details are not implemented in this first step");
  }
}
