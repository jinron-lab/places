import type { Place } from "@/lib/places";

const LOG_PLACE_SELECTION_KEY = "explore.log-place-selection";
let cachedValue: string | null | undefined;
let cachedPlace: Place | null = null;

export function saveLogPlaceSelection(place: Place) {
  const value = JSON.stringify(place);
  cachedValue = value;
  cachedPlace = place;
  window.sessionStorage.setItem(LOG_PLACE_SELECTION_KEY, value);
}

export function readLogPlaceSelection(expectedPlaceId?: string): Place | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(LOG_PLACE_SELECTION_KEY);
    if (!value) return null;
    if (value === cachedValue) return expectedPlaceId && cachedPlace?.id !== expectedPlaceId ? null : cachedPlace;
    const place = JSON.parse(value) as Place;
    if (!place?.id || !place.providerPlaceId || !place.coordinates) return null;
    cachedValue = value;
    cachedPlace = place;
    return expectedPlaceId && place.id !== expectedPlaceId ? null : place;
  } catch {
    return null;
  }
}

export function clearLogPlaceSelection() {
  cachedValue = null;
  cachedPlace = null;
  window.sessionStorage.removeItem(LOG_PLACE_SELECTION_KEY);
}
