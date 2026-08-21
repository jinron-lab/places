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

type PlaceRow = {
  user_id: string;
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
  const [placesResult, entriesResult, categoriesResult, peopleResult] = await Promise.all([
    supabase.from(TABLES.places).select("id, provider, provider_place_id, data").eq("user_id", userId),
    supabase.from(TABLES.entries).select("id, place_id, visited_at, rating, notes, category_ids, person_ids, created_at, updated_at").eq("user_id", userId),
    supabase.from(TABLES.categories).select("id, name, color, icon, created_at").eq("user_id", userId),
    supabase.from(TABLES.people).select("id, name, created_at").eq("user_id", userId),
  ]);

  for (const result of [placesResult, entriesResult, categoriesResult, peopleResult]) {
    throwIfError(result.error);
  }

  const places = (placesResult.data ?? []) as PlaceRow[];
  const entries = (entriesResult.data ?? []) as EntryRow[];
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

function placeRow(place: Place, userId: string): PlaceRow {
  return {
    user_id: userId,
    id: place.id,
    provider: place.provider,
    provider_place_id: place.providerPlaceId,
    data: place,
  };
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

async function upsertRows(table: JournalTable, rows: object[]) {
  if (rows.length === 0) return;
  const { error } = await getSupabaseClient().from(table).upsert(rows, { onConflict: "id" });
  throwIfError(error);
}

async function insertJournalEntries(entries: JournalEntry[], userId: string) {
  if (entries.length === 0) return;
  const rows = entries.map((entry) => entryRow(entry, userId));
  console.info("[journal-create-debug] Supabase insert payload", rows.map((row) => ({
    id: row.id,
    placeId: row.place_id,
    visitedAt: row.visited_at,
    rating: row.rating,
    hasNotes: Boolean(row.notes),
    categoryCount: row.category_ids.length,
    personCount: row.person_ids.length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })));

  const result = await getSupabaseClient()
    .from(TABLES.entries)
    .insert(rows)
    .select("id");

  if (result.error) {
    console.error("[journal-create-debug] Supabase insert error", {
      code: result.error.code,
      message: result.error.message,
      details: result.error.details,
      hint: result.error.hint,
    });
  } else {
    console.info("[journal-create-debug] Supabase insert response", {
      rowCount: result.data?.length ?? 0,
      entryIds: result.data?.map((row) => row.id) ?? [],
    });
  }
  throwIfError(result.error);
}

async function deleteMissingRows(table: JournalTable, userId: string, existingIds: string[], nextIds: string[]) {
  const next = new Set(nextIds);
  const removedIds = existingIds.filter((id) => !next.has(id));
  if (removedIds.length === 0) return;
  const { error } = await getSupabaseClient().from(table).delete().eq("user_id", userId).in("id", removedIds);
  throwIfError(error);
}

async function deleteRows(table: JournalTable, userId: string, ids: string[]) {
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

  await upsertRows(TABLES.places, changedRows(previousPlaces, nextPlaces).map((place) => placeRow(place, userId)));
  await upsertSupabaseCategories(changedRows(previous.categories, next.categories), userId);
  await upsertSupabasePeople(changedRows(previous.people, next.people), userId);
  await insertJournalEntries(createdEntries, userId);
  await upsertRows(TABLES.entries, updatedEntries.map((entry) => entryRow(entry, userId)));

  // Entries must be removed before their places. Category/person references
  // are stored as ID arrays, so their rows can then be deleted independently.
  await deleteRows(TABLES.entries, userId, removedIds(previous.entries, next.entries));
  await deleteRows(TABLES.places, userId, removedIds(previousPlaces, nextPlaces));
  await deleteSupabaseCategories(removedIds(previous.categories, next.categories), userId);
  await deleteSupabasePeople(removedIds(previous.people, next.people), userId);
}

/** Reconciles the four cloud-backed entities with the provider's next state. */
export async function persistSupabaseJournalStore(store: JournalStore, userId: string) {
  const supabase = getSupabaseClient();
  const [placesResult, entriesResult, categoriesResult, peopleResult] = await Promise.all([
    supabase.from(TABLES.places).select("id").eq("user_id", userId),
    supabase.from(TABLES.entries).select("id").eq("user_id", userId),
    supabase.from(TABLES.categories).select("id").eq("user_id", userId),
    supabase.from(TABLES.people).select("id").eq("user_id", userId),
  ]);

  for (const result of [placesResult, entriesResult, categoriesResult, peopleResult]) {
    throwIfError(result.error);
  }

  const places = Object.values(store.places);
  await upsertRows(TABLES.places, places.map((place) => placeRow(place, userId)));
  await upsertRows(TABLES.categories, store.categories.map((category) => categoryRow(category, userId)));
  await upsertRows(TABLES.people, store.people.map((person) => personRow(person, userId)));
  await upsertRows(TABLES.entries, store.entries.map((entry) => entryRow(entry, userId)));

  await deleteMissingRows(TABLES.entries, userId, (entriesResult.data ?? []).map((row) => row.id), store.entries.map((entry) => entry.id));
  await deleteMissingRows(TABLES.places, userId, (placesResult.data ?? []).map((row) => row.id), places.map((place) => place.id));
  await deleteMissingRows(TABLES.categories, userId, (categoriesResult.data ?? []).map((row) => row.id), store.categories.map((category) => category.id));
  await deleteMissingRows(TABLES.people, userId, (peopleResult.data ?? []).map((row) => row.id), store.people.map((person) => person.id));
}

export function hasCloudData(store: JournalStore) {
  return store.entries.length > 0
    || Object.keys(store.places).length > 0
    || store.categories.length > 0
    || store.people.length > 0;
}
