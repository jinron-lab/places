import type { Category, JournalEntry, Person } from "@/lib/journal";
import {
  JOURNAL_SCHEMA_VERSION,
  migrateJournalStore,
  type JournalStore,
} from "@/lib/journal-storage";
import type { Place } from "@/lib/places";
import { getSupabaseClient } from "@/lib/supabase";

const TABLES = {
  places: "places",
  entries: "journal_entries",
  categories: "categories",
  people: "people",
} as const;

type JournalTable = (typeof TABLES)[keyof typeof TABLES];
type OwnedJournalTable = Exclude<JournalTable, "places">;

type PlaceRow = {
  id: string;
  provider: Place["provider"];
  provider_place_id: string;
  data: Place;
};

type EntryRow = {
  user_id: string;
  id: string;
  place_id: string;
  visited_at: string;
  rating: number | null;
  notes: string | null;
  category_ids: string[];
  person_ids: string[];
  created_at: string;
  updated_at: string;
};

type CategoryRow = {
  user_id: string;
  id: string;
  name: string;
  color: string;
  icon: string | null;
  created_at: string;
};

type PersonRow = {
  user_id: string;
  id: string;
  name: string;
  created_at: string;
};

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadSupabaseJournalStore(userId: string): Promise<JournalStore> {
  const supabase = getSupabaseClient();
  const [entriesResult, categoriesResult, peopleResult] = await Promise.all([
    supabase.from(TABLES.entries).select("id, place_id, visited_at, rating, notes, category_ids, person_ids, created_at, updated_at").eq("user_id", userId),
    supabase.from(TABLES.categories).select("id, name, color, icon, created_at").eq("user_id", userId),
    supabase.from(TABLES.people).select("id, name, created_at").eq("user_id", userId),
  ]);

  for (const result of [entriesResult, categoriesResult, peopleResult]) {
    throwIfError(result.error);
  }

  const entries = (entriesResult.data ?? []) as EntryRow[];
  const placeIds = Array.from(new Set(entries.map((entry) => entry.place_id)));
  const placesResult = placeIds.length > 0
    ? await supabase.from(TABLES.places).select("id, provider, provider_place_id, data").in("id", placeIds)
    : { data: [] as PlaceRow[], error: null };
  throwIfError(placesResult.error);

  const places = (placesResult.data ?? []) as PlaceRow[];
  const categories = (categoriesResult.data ?? []) as CategoryRow[];
  const people = (peopleResult.data ?? []) as PersonRow[];
  const migrated = migrateJournalStore({
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    places: Object.fromEntries(places.map((row) => [row.id, { ...row.data, id: row.id }])),
    entries: entries.map((row) => ({
      id: row.id,
      placeId: row.place_id,
      visitedAt: row.visited_at,
      rating: row.rating ?? undefined,
      notes: row.notes ?? undefined,
      categoryIds: row.category_ids ?? [],
      personIds: row.person_ids ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    categories: categories.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      icon: row.icon ?? undefined,
      createdAt: row.created_at,
    })),
    people: people.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
    })),
    sideQuests: [],
  });

  if (!migrated) throw new Error("Supabase returned journal data in an unsupported shape.");
  return migrated;
}

function entryRow(entry: JournalEntry, userId: string): EntryRow {
  return {
    user_id: userId,
    id: entry.id,
    place_id: entry.placeId,
    visited_at: entry.visitedAt,
    rating: entry.rating ?? null,
    notes: entry.notes ?? null,
    category_ids: entry.categoryIds,
    person_ids: entry.personIds,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

function categoryRow(category: Category, userId: string): CategoryRow {
  return {
    user_id: userId,
    id: category.id,
    name: category.name,
    color: category.color,
    icon: category.icon ?? null,
    created_at: category.createdAt,
  };
}

function personRow(person: Person, userId: string): PersonRow {
  return {
    user_id: userId,
    id: person.id,
    name: person.name,
    created_at: person.createdAt,
  };
}

async function upsertRows(table: OwnedJournalTable, rows: object[]) {
  if (rows.length === 0) return;
  const { error } = await getSupabaseClient().from(table).upsert(rows, { onConflict: "id" });
  throwIfError(error);
}

async function insertJournalEntries(entries: JournalEntry[], userId: string) {
  if (entries.length === 0) return;
  const rows = entries.map((entry) => entryRow(entry, userId));
  const { error } = await getSupabaseClient()
    .from(TABLES.entries)
    .insert(rows);
  throwIfError(error);
}

async function deleteMissingRows(table: OwnedJournalTable, userId: string, existingIds: string[], nextIds: string[]) {
  const next = new Set(nextIds);
  const removedIds = existingIds.filter((id) => !next.has(id));
  if (removedIds.length === 0) return;
  const { error } = await getSupabaseClient().from(table).delete().eq("user_id", userId).in("id", removedIds);
  throwIfError(error);
}

async function deleteRows(table: OwnedJournalTable, userId: string, ids: string[]) {
  if (ids.length === 0) return;
  const { error } = await getSupabaseClient().from(table).delete().eq("user_id", userId).in("id", ids);
  throwIfError(error);
}

function changedRows<T extends { id: string }>(previous: T[], next: T[]) {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  return next.filter((item) => {
    const existing = previousById.get(item.id);
    return !existing || JSON.stringify(existing) !== JSON.stringify(item);
  });
}

function removedIds<T extends { id: string }>(previous: T[], next: T[]) {
  const nextIds = new Set(next.map((item) => item.id));
  return previous.filter((item) => !nextIds.has(item.id)).map((item) => item.id);
}

async function ensureGlobalPlaces(places: Place[]) {
  const supabase = getSupabaseClient();
  for (const place of places) {
    const { error } = await supabase.rpc("ensure_place", {
      p_id: place.id,
      p_provider: place.provider,
      p_provider_place_id: place.providerPlaceId,
      p_data: place,
    });
    throwIfError(error);
  }
}

export async function upsertSupabaseCategories(categories: Category[], userId: string) {
  await upsertRows(TABLES.categories, categories.map((category) => categoryRow(category, userId)));
}

export async function deleteSupabaseCategories(categoryIds: string[], userId: string) {
  await deleteRows(TABLES.categories, userId, categoryIds);
}

export async function upsertSupabasePeople(people: Person[], userId: string) {
  await upsertRows(TABLES.people, people.map((person) => personRow(person, userId)));
}

export async function deleteSupabasePeople(personIds: string[], userId: string) {
  await deleteRows(TABLES.people, userId, personIds);
}

/** Persists one provider update without requiring a broad cloud reconciliation. */
export async function persistSupabaseJournalChanges(previous: JournalStore, next: JournalStore, userId: string) {
  const previousPlaces = Object.values(previous.places);
  const nextPlaces = Object.values(next.places);
  const previousEntryIds = new Set(previous.entries.map((entry) => entry.id));
  const createdEntries = next.entries.filter((entry) => !previousEntryIds.has(entry.id));
  const updatedEntries = changedRows(previous.entries, next.entries)
    .filter((entry) => previousEntryIds.has(entry.id));

  await ensureGlobalPlaces(changedRows(previousPlaces, nextPlaces));
  await upsertSupabaseCategories(changedRows(previous.categories, next.categories), userId);
  await upsertSupabasePeople(changedRows(previous.people, next.people), userId);
  await insertJournalEntries(createdEntries, userId);
  await upsertRows(TABLES.entries, updatedEntries.map((entry) => entryRow(entry, userId)));

  // Global provider POIs are never deleted during one user's reconciliation.
  // Category/person references are stored as ID arrays and remain user-owned.
  await deleteRows(TABLES.entries, userId, removedIds(previous.entries, next.entries));
  await deleteSupabaseCategories(removedIds(previous.categories, next.categories), userId);
  await deleteSupabasePeople(removedIds(previous.people, next.people), userId);
}

/** Reconciles owned cloud entities after ensuring their referenced global POIs. */
export async function persistSupabaseJournalStore(store: JournalStore, userId: string) {
  const supabase = getSupabaseClient();
  const [entriesResult, categoriesResult, peopleResult] = await Promise.all([
    supabase.from(TABLES.entries).select("id").eq("user_id", userId),
    supabase.from(TABLES.categories).select("id").eq("user_id", userId),
    supabase.from(TABLES.people).select("id").eq("user_id", userId),
  ]);

  for (const result of [entriesResult, categoriesResult, peopleResult]) {
    throwIfError(result.error);
  }

  const places = Object.values(store.places);
  await ensureGlobalPlaces(places);
  await upsertRows(TABLES.categories, store.categories.map((category) => categoryRow(category, userId)));
  await upsertRows(TABLES.people, store.people.map((person) => personRow(person, userId)));
  await upsertRows(TABLES.entries, store.entries.map((entry) => entryRow(entry, userId)));

  await deleteMissingRows(TABLES.entries, userId, (entriesResult.data ?? []).map((row) => row.id), store.entries.map((entry) => entry.id));
  await deleteMissingRows(TABLES.categories, userId, (categoriesResult.data ?? []).map((row) => row.id), store.categories.map((category) => category.id));
  await deleteMissingRows(TABLES.people, userId, (peopleResult.data ?? []).map((row) => row.id), store.people.map((person) => person.id));
}

export function hasCloudData(store: JournalStore) {
  return store.entries.length > 0
    || Object.keys(store.places).length > 0
    || store.categories.length > 0
    || store.people.length > 0;
}
