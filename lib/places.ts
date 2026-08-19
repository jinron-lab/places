export type PlaceProvider = "amap" | "google";

export type PlaceCategory =
  | "restaurant"
  | "coffee"
  | "landmark"
  | "museum"
  | "park";

/** Localized metadata supplied by a place provider, never by the user. */
export type ProviderPlaceMetadata = {
  name: string;
  nameLocal?: string;
  providerId?: string;
};

/** Provider-neutral data about one real-world point of interest. */
export type Place = {
  id: string;
  provider: PlaceProvider;
  providerPlaceId: string;
  name: string;
  nameLocal?: string;
  aliases: string[];
  category: PlaceCategory;
  categoryLabel: string;
  providerCategories: ProviderPlaceMetadata[];
  providerTags: ProviderPlaceMetadata[];
  address: string;
  city: string;
  countryCode: string;
  coordinates: { lat: number; lng: number };
  providerRating?: number;
  providerReviewCount?: number;
  providerPriceLevel?: 1 | 2 | 3 | 4;
  hours?: string;
  phone?: string;
};

/** Data that exists only in the context of a particular provider search. */
export type PlaceSearchResult = {
  place: Place;
  distanceMeters?: number;
};

export interface PlacesProviderAdapter {
  provider: PlaceProvider;
  search(
    query: string,
    near?: Place["coordinates"],
  ): Promise<PlaceSearchResult[]>;
  getPlace(providerPlaceId: string): Promise<Place | null>;
}

export const categoryMeta: Record<
  PlaceCategory,
  { label: string; icon: string }
> = {
  restaurant: { label: "Food", icon: "◒" },
  coffee: { label: "Coffee", icon: "☕" },
  landmark: { label: "Sights", icon: "⌂" },
  museum: { label: "Museums", icon: "▥" },
  park: { label: "Outdoors", icon: "♧" },
};
