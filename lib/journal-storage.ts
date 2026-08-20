import type { Category, JournalEntry, Person } from "@/lib/journal";
import type { Place } from "@/lib/places";
import { getDefaultCategoryColor } from "@/lib/category-appearance";
import { enrichProviderMetadata } from "@/lib/provider-metadata";
import { createUuid } from "@/lib/id";
import type { SideQuest } from "@/lib/side-quests";

export const JOURNAL_STORAGE_KEY = "explore.journal.v1";
export const SIDE_QUEST_STORAGE_KEY = "explore.side-quests.v1";
export const JOURNAL_SCHEMA_VERSION = 8 as const;

export type JournalStore = {
  schemaVersion: typeof JOURNAL_SCHEMA_VERSION;
  entries: JournalEntry[];
  places: Record<string, Place>;
  categories: Category[];
  people: Person[];
  sideQuests: SideQuest[];
};

type LegacyJournalEntry = JournalEntry & {
  categories?: Array<{ name?: string }>;
  people?: Array<{ name?: string }>;
  visitTags?: unknown[];
};

export function createEmptyJournalStore(): JournalStore {
  return {
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    entries: [],
    places: {},
    categories: [],
    people: [],
    sideQuests: [],
  };
}

function createEntityId(prefix: "category" | "person") {
  return `${prefix}:${createUuid()}`;
}

function normalizeRating(value: unknown): JournalEntry["rating"] {
  const numeric = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) return undefined;
  return Math.min(5, Math.max(0.5, Math.round(numeric * 2) / 2)) as JournalEntry["rating"];
}

/** Converts every supported legacy localStorage shape into the current schema. */
export function migrateJournalStore(value: unknown): JournalStore | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as {
    schemaVersion?: number;
    entries?: unknown[];
    places?: Record<string, Place>;
    categories?: Category[];
    people?: Person[];
    sideQuests?: SideQuest[];
  };

  if (typeof raw.schemaVersion === "number" && raw.schemaVersion > JOURNAL_SCHEMA_VERSION) return null;
  if (!Array.isArray(raw.entries) || !raw.places || typeof raw.places !== "object") return null;

  const now = new Date().toISOString();
  const categories = Array.isArray(raw.categories)
    ? raw.categories
        .filter((item) => Boolean(item?.id && item?.name))
        .map((item) => ({ ...item, color: item.color || getDefaultCategoryColor(item.id) }))
    : [];
  const people = Array.isArray(raw.people)
    ? raw.people.filter((item) => Boolean(item?.id && item?.name))
    : [];

  function entityId(name: string, entities: Array<Category | Person>, prefix: "category" | "person") {
    const existing = entities.find((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing) return existing.id;

    const id = createEntityId(prefix);
    const entity: Category | Person = prefix === "category"
      ? { id, name, color: getDefaultCategoryColor(id), createdAt: now }
      : { id, name, createdAt: now };
    entities.push(entity);
    return entity.id;
  }

  const entries = raw.entries.map((value) => {
    const entry = value as LegacyJournalEntry;
    const legacyCategoryIds = Array.isArray(entry.categories)
      ? entry.categories
          .map((item) => item?.name?.trim())
          .filter((name): name is string => Boolean(name))
          .map((name) => entityId(name, categories, "category"))
      : [];
    const legacyPersonIds = Array.isArray(entry.people)
      ? entry.people
          .map((item) => item?.name?.trim())
          .filter((name): name is string => Boolean(name))
          .map((name) => entityId(name, people, "person"))
      : [];
    const quickLogLines = Array.isArray(entry.visitTags)
      ? entry.visitTags.filter((tag): tag is string => typeof tag === "string" && Boolean(tag.trim())).map((tag) => tag.trim())
      : [];
    const notes = [entry.notes?.trim(), ...quickLogLines].filter(Boolean).join("\n") || undefined;
    const { categories: _categories, people: _people, visitTags: _visitTags, ...currentEntry } = entry;
    void _categories;
    void _people;
    void _visitTags;

    return {
      ...currentEntry,
      rating: normalizeRating(entry.rating),
      notes,
      categoryIds: Array.isArray(entry.categoryIds) ? entry.categoryIds : legacyCategoryIds,
      personIds: Array.isArray(entry.personIds) ? entry.personIds : legacyPersonIds,
    };
  });

  return {
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    entries,
    places: Object.fromEntries(Object.entries(raw.places).map(([id, place]) => {
      const legacyPlace = place as Place & { tags?: string[] };
      const providerCategories = Array.isArray(legacyPlace.providerCategories)
        ? legacyPlace.providerCategories.map(enrichProviderMetadata)
        : [{ name: legacyPlace.categoryLabel || "Place" }];
      const providerTags = Array.isArray(legacyPlace.providerTags)
        ? legacyPlace.providerTags.map(enrichProviderMetadata)
        : (legacyPlace.tags ?? []).map((name) => enrichProviderMetadata({ name }));
      const { tags: _tags, ...currentPlace } = legacyPlace;
      void _tags;
      return [id, {
        ...currentPlace,
        aliases: Array.isArray(legacyPlace.aliases) ? legacyPlace.aliases : [],
        providerCategories: providerCategories.map(enrichProviderMetadata),
        providerTags,
      }];
    })),
    categories,
    people,
    sideQuests: Array.isArray(raw.sideQuests) ? raw.sideQuests : [],
  };
}

export function readJournalStore(): JournalStore {
  if (typeof window === "undefined") return createEmptyJournalStore();

  try {
    const storedValue = window.localStorage.getItem(JOURNAL_STORAGE_KEY);
    if (!storedValue) return createEmptyJournalStore();

    const migrated = migrateJournalStore(JSON.parse(storedValue) as unknown);
    if (!migrated) return createEmptyJournalStore();

    writeJournalStore(migrated);
    return migrated;
  } catch {
    return createEmptyJournalStore();
  }
}

export function writeJournalStore(store: JournalStore) {
  window.localStorage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(store));
}

export function readLocalSideQuests(fallback: SideQuest[] = []): SideQuest[] {
  if (typeof window === "undefined") return fallback;

  try {
    const value = window.localStorage.getItem(SIDE_QUEST_STORAGE_KEY);
    return value ? (JSON.parse(value) as SideQuest[]) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocalSideQuests(sideQuests: SideQuest[]) {
  window.localStorage.setItem(SIDE_QUEST_STORAGE_KEY, JSON.stringify(sideQuests));
}
