import type { Category, JournalEntry, Person } from "@/lib/journal";
import {
  JOURNAL_SCHEMA_VERSION,
  migrateJournalStore,
  type JournalStore,
} from "@/lib/journal-storage";
import type { Place } from "@/lib/places";
import { getSupabaseClient } from "@/lib/supabase";
import type { JournalMutation } from "@/app/journal-provider";

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
  linked_user_id: string | null;
  linked_at: string | null;
};

type EntryPersonRow = { entry_id: string; person_id: string };
type ProfileRow = { user_id: string; username: string; display_name: string };

type SupabaseLoadError = { code?: string; message: string };

class JournalLoadError extends Error {
  code?: string;

  constructor(request: string, error: SupabaseLoadError) {
    super(`${request}: ${error.message}`);
    this.name = "SupabaseJournalLoadError";
    this.code = error.code;
  }
}

export function isTransientJournalLoadError(error: unknown) {
  if (!(error instanceof JournalLoadError)) return false;
  return error.code === "PGRST301"
    || /failed to fetch|network|timeout|timed out|connection|load failed/i.test(error.message);
}

function throwLoadError(request: string, error: SupabaseLoadError | null, diagnostic: boolean) {
  if (!error) return;
  if (diagnostic) {
    console.error("[initial-journal-load] Supabase request failed.", {
      request,
      code: error.code ?? null,
      message: error.message,
    });
  }
  throw new JournalLoadError(request, error);
}

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadSupabaseJournalStore(
  userId: string,
  options: { diagnostic?: boolean } = {},
): Promise<JournalStore> {
  const diagnostic = options.diagnostic ?? false;
  const supabase = getSupabaseClient();
  const [entriesResult, categoriesResult, peopleResult] = await Promise.all([
    supabase.from(TABLES.entries).select("user_id, id, place_id, visited_at, rating, notes, category_ids, person_ids, created_at, updated_at"),
    supabase.from(TABLES.categories).select("id, name, color, icon, created_at").eq("user_id", userId),
    supabase.from(TABLES.people).select("user_id, id, name, created_at, linked_user_id, linked_at").eq("user_id", userId),
  ]);

  throwLoadError("journal_entries", entriesResult.error, diagnostic);
  throwLoadError("categories", categoriesResult.error, diagnostic);
  throwLoadError("people", peopleResult.error, diagnostic);

  const entries = (entriesResult.data ?? []) as EntryRow[];
  const entryIds = entries.map((entry) => entry.id);
  const ownerIds = Array.from(new Set(entries.map((entry) => entry.user_id)));
  const linkedUserIds = Array.from(new Set(((peopleResult.data ?? []) as PersonRow[]).map((person) => person.linked_user_id).filter((id): id is string => Boolean(id))));
  const [entryPeopleResult, profilesResult] = await Promise.all([
    entryIds.length > 0
      ? supabase.from("journal_entry_people").select("entry_id, person_id").in("entry_id", entryIds)
      : Promise.resolve({ data: [] as EntryPersonRow[], error: null }),
    ownerIds.length > 0 || linkedUserIds.length > 0
      ? supabase.from("profiles").select("user_id, username, display_name").in("user_id", Array.from(new Set([...ownerIds, ...linkedUserIds])))
      : Promise.resolve({ data: [] as ProfileRow[], error: null }),
  ]);
  throwLoadError("journal_entry_people", entryPeopleResult.error, diagnostic);
  throwLoadError("profiles", profilesResult.error, diagnostic);
  const normalizedPeople = (entryPeopleResult.data ?? []) as EntryPersonRow[];
  const profilesById = new Map(((profilesResult.data ?? []) as ProfileRow[]).map((profile) => [profile.user_id, profile]));
  const personIdsByEntry = new Map<string, string[]>();
  for (const tag of normalizedPeople) personIdsByEntry.set(tag.entry_id, [...(personIdsByEntry.get(tag.entry_id) ?? []), tag.person_id]);
  const placeIds = Array.from(new Set(entries.map((entry) => entry.place_id)));
  const placesResult = placeIds.length > 0
    ? await supabase.from(TABLES.places).select("id, provider, provider_place_id, data").in("id", placeIds)
    : { data: [] as PlaceRow[], error: null };
  throwLoadError("places", placesResult.error, diagnostic);

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
      personIds: personIdsByEntry.get(row.id) ?? row.person_ids ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ownerId: row.user_id,
      access: row.user_id === userId ? "owned" : "shared",
      ownerUsername: profilesById.get(row.user_id)?.username,
      ownerDisplayName: profilesById.get(row.user_id)?.display_name,
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
      linkedUserId: row.linked_user_id ?? undefined,
      linkedAt: row.linked_at ?? undefined,
      linkedUsername: row.linked_user_id ? profilesById.get(row.linked_user_id)?.username : undefined,
      linkedDisplayName: row.linked_user_id ? profilesById.get(row.linked_user_id)?.display_name : undefined,
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
    linked_user_id: person.linkedUserId ?? null,
    linked_at: person.linkedAt ?? null,
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

async function saveEntryPeople(entries: JournalEntry[]) {
  const supabase = getSupabaseClient();
  for (const entry of entries) {
    const { error } = await supabase.rpc("save_journal_entry_people", {
      p_entry_id: entry.id,
      p_person_ids: entry.personIds,
    });
    throwIfError(error);
  }
}

async function leaveSharedEntries(entryIds: string[]) {
  const supabase = getSupabaseClient();
  for (const entryId of entryIds) {
    const { error } = await supabase.rpc("leave_shared_entry", { p_entry_id: entryId });
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
export async function persistSupabaseJournalChanges(
  previous: JournalStore,
  next: JournalStore,
  userId: string,
  mutation: JournalMutation = {},
) {
  const previousPlaces = Object.values(previous.places);
  const nextPlaces = Object.values(next.places);
  const previousEntryIds = new Set(previous.entries.map((entry) => entry.id));
  const createdEntries = next.entries.filter((entry) => !previousEntryIds.has(entry.id));
  const updatedEntries = changedRows(previous.entries, next.entries)
    .filter((entry) => previousEntryIds.has(entry.id) && (entry.ownerId ?? userId) === userId);

  await ensureGlobalPlaces(changedRows(previousPlaces, nextPlaces));
  await upsertSupabaseCategories(changedRows(previous.categories, next.categories), userId);
  await upsertSupabasePeople(changedRows(previous.people, next.people), userId);
  await insertJournalEntries(createdEntries, userId);
  await upsertRows(TABLES.entries, updatedEntries.map((entry) => entryRow(entry, userId)));
  await saveEntryPeople([...createdEntries, ...updatedEntries]);

  // Global provider POIs are never deleted during one user's reconciliation.
  // Category/person references are stored as ID arrays and remain user-owned.
  await deleteRows(TABLES.entries, userId, mutation.deletedEntryIds ?? []);
  await deleteSupabaseCategories(mutation.deletedCategoryIds ?? [], userId);
  await deleteSupabasePeople(mutation.deletedPersonIds ?? [], userId);
  await leaveSharedEntries(mutation.leftSharedEntryIds ?? []);
}
