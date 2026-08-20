import { JOURNAL_SCHEMA_VERSION, migrateJournalStore, type JournalStore } from "@/lib/journal-storage";

const BACKUP_FORMAT = "explore-journal-backup";
const BACKUP_VERSION = 1;

type JournalBackup = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  data: JournalStore;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasString(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "string" && Boolean((value[key] as string).trim());
}

function hasUniqueIds(items: unknown[]) {
  const ids = items.map((item) => isObject(item) ? item.id : undefined);
  return ids.every((id) => typeof id === "string" && Boolean(id)) && new Set(ids).size === ids.length;
}

/** Creates a user-neutral backup. Supabase ownership columns are never included. */
export function createJournalBackup(store: JournalStore): JournalBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: store,
  };
}

/** Validates a backup before it can replace the current user's journal. */
export function parseJournalBackup(value: unknown): JournalStore {
  if (!isObject(value) || value.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION || !isObject(value.data)) {
    throw new Error("This is not a supported Explore backup file.");
  }

  const data = value.data;
  if (data.schemaVersion !== JOURNAL_SCHEMA_VERSION
    || !Array.isArray(data.entries)
    || !isObject(data.places)
    || !Array.isArray(data.categories)
    || !Array.isArray(data.people)
    || !Array.isArray(data.sideQuests)) {
    throw new Error("The backup has an unsupported or incomplete journal structure.");
  }

  const places = Object.values(data.places);
  const placeIds = new Set(Object.keys(data.places));
  const categories = data.categories;
  const people = data.people;
  const entries = data.entries;
  const sideQuests = data.sideQuests;

  if (!hasUniqueIds(places) || !hasUniqueIds(categories) || !hasUniqueIds(people) || !hasUniqueIds(entries) || !hasUniqueIds(sideQuests)) {
    throw new Error("The backup contains missing or duplicate record IDs.");
  }

  for (const [key, rawPlace] of Object.entries(data.places)) {
    if (!isObject(rawPlace)
      || rawPlace.id !== key
      || !hasString(rawPlace, "providerPlaceId")
      || !hasString(rawPlace, "name")
      || !["amap", "google"].includes(String(rawPlace.provider))
      || !["restaurant", "coffee", "landmark", "museum", "park"].includes(String(rawPlace.category))
      || !isObject(rawPlace.coordinates)
      || !Number.isFinite(rawPlace.coordinates.lat)
      || !Number.isFinite(rawPlace.coordinates.lng)) {
      throw new Error(`The backup contains an invalid place (${key}).`);
    }
  }

  const categoryIds = new Set(categories.map((item) => isObject(item) ? item.id : undefined));
  const personIds = new Set(people.map((item) => isObject(item) ? item.id : undefined));
  for (const rawEntry of entries) {
    if (!isObject(rawEntry)
      || !hasString(rawEntry, "placeId")
      || !placeIds.has(rawEntry.placeId as string)
      || !hasString(rawEntry, "visitedAt")
      || !Array.isArray(rawEntry.categoryIds)
      || !rawEntry.categoryIds.every((id) => typeof id === "string" && categoryIds.has(id))
      || !Array.isArray(rawEntry.personIds)
      || !rawEntry.personIds.every((id) => typeof id === "string" && personIds.has(id))) {
      throw new Error(`The backup contains an invalid journal entry (${String(rawEntry.id ?? "unknown")}).`);
    }
  }

  for (const rawCategory of categories) {
    if (!isObject(rawCategory) || !hasString(rawCategory, "name") || !hasString(rawCategory, "color") || !hasString(rawCategory, "createdAt")) {
      throw new Error("The backup contains an invalid category.");
    }
  }
  for (const rawPerson of people) {
    if (!isObject(rawPerson) || !hasString(rawPerson, "name") || !hasString(rawPerson, "createdAt")) {
      throw new Error("The backup contains an invalid person.");
    }
  }
  for (const rawQuest of sideQuests) {
    if (!isObject(rawQuest)
      || !hasString(rawQuest, "templateId")
      || !hasString(rawQuest, "title")
      || !hasString(rawQuest, "description")
      || !["active", "completed"].includes(String(rawQuest.status))
      || !Array.isArray(rawQuest.linkedJournalEntryIds)) {
      throw new Error("The backup contains an invalid side quest.");
    }
  }

  const migrated = migrateJournalStore(data);
  if (!migrated) throw new Error("The backup could not be converted to the current journal format.");
  return migrated;
}
