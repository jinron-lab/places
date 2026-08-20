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
  id: string;
  provider: Place["provider"];
  provider_place_id: string;
  data: Place;
};

type EntryRow = {
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
  id: string;
  name: string;
  color: string;
  icon: string | null;
  created_at: string;
};

type PersonRow = {
  id: string;
  name: string;
  created_at: string;
};

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadSupabaseJournalStore(): Promise<JournalStore> {
  const supabase = getSupabaseClient();
  const [placesResult, entriesResult, categoriesResult, peopleResult] = await Promise.all([
    supabase.from(TABLES.places).select("id, provider, provider_place_id, data"),
    supabase.from(TABLES.entries).select("id, place_id, visited_at, rating, notes, category_ids, person_ids, created_at, updated_at"),
    supabase.from(TABLES.categories).select("id, name, color, icon, created_at"),
    supabase.from(TABLES.people).select("id, name, created_at"),
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

function placeRow(place: Place): PlaceRow {
  return {
    id: place.id,
    provider: place.provider,
    provider_place_id: place.providerPlaceId,
    data: place,
  };
}

function entryRow(entry: JournalEntry): EntryRow {
  return {
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

function categoryRow(category: Category): CategoryRow {
  return {
    id: category.id,
    name: category.name,
    color: category.color,
    icon: category.icon ?? null,
    created_at: category.createdAt,
  };
}

function personRow(person: Person): PersonRow {
  return {
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

async function deleteMissingRows(table: JournalTable, existingIds: string[], nextIds: string[]) {
  const next = new Set(nextIds);
  const removedIds = existingIds.filter((id) => !next.has(id));
  if (removedIds.length === 0) return;
  const { error } = await getSupabaseClient().from(table).delete().in("id", removedIds);
  throwIfError(error);
}

/** Reconciles the four cloud-backed entities with the provider's next state. */
export async function persistSupabaseJournalStore(store: JournalStore) {
  const supabase = getSupabaseClient();
  const [placesResult, entriesResult, categoriesResult, peopleResult] = await Promise.all([
    supabase.from(TABLES.places).select("id"),
    supabase.from(TABLES.entries).select("id"),
    supabase.from(TABLES.categories).select("id"),
    supabase.from(TABLES.people).select("id"),
  ]);

  for (const result of [placesResult, entriesResult, categoriesResult, peopleResult]) {
    throwIfError(result.error);
  }

  const places = Object.values(store.places);
  await upsertRows(TABLES.places, places.map(placeRow));
  await upsertRows(TABLES.categories, store.categories.map(categoryRow));
  await upsertRows(TABLES.people, store.people.map(personRow));
  await upsertRows(TABLES.entries, store.entries.map(entryRow));

  await deleteMissingRows(TABLES.entries, (entriesResult.data ?? []).map((row) => row.id), store.entries.map((entry) => entry.id));
  await deleteMissingRows(TABLES.places, (placesResult.data ?? []).map((row) => row.id), places.map((place) => place.id));
  await deleteMissingRows(TABLES.categories, (categoriesResult.data ?? []).map((row) => row.id), store.categories.map((category) => category.id));
  await deleteMissingRows(TABLES.people, (peopleResult.data ?? []).map((row) => row.id), store.people.map((person) => person.id));
}

export function hasCloudData(store: JournalStore) {
  return store.entries.length > 0
    || Object.keys(store.places).length > 0
    || store.categories.length > 0
    || store.people.length > 0;
}
