import type { JournalEntry } from "@/lib/journal";
import type { JournalStore } from "@/lib/journal-storage";
import type { Place } from "@/lib/places";

export const ALL_PLACES_COLLECTION_ID = "all-places";

export type VisiblePlaceGroup = {
  place: Place;
  entries: JournalEntry[];
  latestVisit: JournalEntry;
  hasSharedVisits: boolean;
};

/** Derives the unique places represented by the already-authorized journal entry set. */
export function getVisiblePlaceGroups(journal: JournalStore): VisiblePlaceGroup[] {
  const entriesByPlace = new Map<string, JournalEntry[]>();
  for (const entry of journal.entries) {
    if (!journal.places[entry.placeId]) continue;
    entriesByPlace.set(entry.placeId, [...(entriesByPlace.get(entry.placeId) ?? []), entry]);
  }

  return Array.from(entriesByPlace, ([placeId, entries]) => {
    const sortedEntries = entries.sort((a, b) => b.visitedAt.localeCompare(a.visitedAt));
    return {
      place: journal.places[placeId],
      entries: sortedEntries,
      latestVisit: sortedEntries[0],
      hasSharedVisits: sortedEntries.some((entry) => entry.access === "shared"),
    };
  }).sort((a, b) => b.latestVisit.visitedAt.localeCompare(a.latestVisit.visitedAt));
}
