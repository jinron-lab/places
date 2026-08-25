import type { Place } from "@/lib/places";

export type PersonalRating = 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 3.5 | 4 | 4.5 | 5;

export const QUICK_LOG_TAGS = ["Relaxing", "Great food", "Nice atmosphere", "Good company", "Worth revisiting", "Hidden gem"] as const;

export function formatPersonalRating(rating?: number) {
  if (!rating) return "";
  return `${"★".repeat(Math.floor(rating))}${rating % 1 ? "½" : ""}`;
}

export type Category = {
  id: string;
  name: string;
  color: string;
  icon?: string;
  createdAt: string;
};

export type Person = {
  id: string;
  name: string;
  createdAt: string;
  linkedUserId?: string;
  linkedAt?: string;
  linkedUsername?: string;
  linkedDisplayName?: string;
};

/** One personal visit to a real-world place. */
export type JournalEntry = {
  id: string;
  placeId: Place["id"];
  visitedAt: string;
  rating?: PersonalRating;
  notes?: string;
  categoryIds: Category["id"][];
  personIds: Person["id"][];
  createdAt: string;
  updatedAt: string;
  ownerId?: string;
  access?: "owned" | "shared";
  ownerUsername?: string;
  ownerDisplayName?: string;
};

/** Metadata for a photo attached to one journal entry. */
export type JournalPhoto = {
  id: string;
  journalEntryId: JournalEntry["id"];
  storageKey: string;
  caption?: string;
  width?: number;
  height?: number;
  createdAt: string;
};

export type JournalEntryWithPlace = JournalEntry & {
  place: Place;
  photos: JournalPhoto[];
};
