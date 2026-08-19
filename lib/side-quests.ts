import type { JournalEntry } from "@/lib/journal";
import { createUuid } from "@/lib/id";
import type { Place } from "@/lib/places";

export type SideQuestStatus = "active" | "completed";

export type SideQuest = {
  id: string;
  templateId: string;
  title: string;
  description: string;
  status: SideQuestStatus;
  linkedJournalEntryIds: JournalEntry["id"][];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

type QuestJournalData = {
  entries: JournalEntry[];
  places: Record<string, Place>;
  categories: Array<{ id: string; name: string }>;
};

type QuestDraft = Pick<SideQuest, "templateId" | "title" | "description" | "linkedJournalEntryIds">;

function journalBasedDrafts(journal: QuestJournalData): QuestDraft[] {
  const ratedEntry = [...journal.entries]
    .filter((entry) => entry.rating !== undefined && journal.places[entry.placeId])
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
  const oldestEntry = [...journal.entries]
    .filter((entry) => journal.places[entry.placeId])
    .sort((a, b) => a.visitedAt.localeCompare(b.visitedAt))[0];
  const favoriteCategory = journal.categories
    .map((category) => ({
      category,
      entries: journal.entries.filter((entry) => entry.categoryIds.includes(category.id)),
    }))
    .filter((item) => item.entries.length > 0)
    .sort((a, b) => b.entries.length - a.entries.length)[0];
  const drafts: QuestDraft[] = [];

  if (ratedEntry) {
    const place = journal.places[ratedEntry.placeId];
    drafts.push({
      templateId: "revisit-favorite",
      title: `Return to ${place.name}`,
      description: "Revisit a place you rated highly and notice what feels different this time.",
      linkedJournalEntryIds: [ratedEntry.id],
    });
  }

  if (oldestEntry && oldestEntry.id !== ratedEntry?.id) {
    const place = journal.places[oldestEntry.placeId];
    drafts.push({
      templateId: "revisit-old-memory",
      title: `Revisit an old memory at ${place.name}`,
      description: "Return to one of your earliest journal places and add a new chapter.",
      linkedJournalEntryIds: [oldestEntry.id],
    });
  }

  if (favoriteCategory) {
    drafts.push({
      templateId: "extend-collection",
      title: `Add a new story to ${favoriteCategory.category.name}`,
      description: `Visit somewhere new that belongs in your ${favoriteCategory.category.name} collection.`,
      linkedJournalEntryIds: favoriteCategory.entries.slice(0, 3).map((entry) => entry.id),
    });
  }

  return drafts;
}

const generalDrafts: QuestDraft[] = [
  {
    templateId: "new-neighborhood",
    title: "Explore a neighborhood you have never visited",
    description: "Choose an unfamiliar area, wander without a fixed destination, and log one place that stays with you.",
    linkedJournalEntryIds: [],
  },
  {
    templateId: "three-traditional-restaurants",
    title: "Try three traditional restaurants",
    description: "Visit three restaurants serving local dishes and record what made each one memorable.",
    linkedJournalEntryIds: [],
  },
  {
    templateId: "book-cafe-gallery",
    title: "Visit a bookstore, cafe, and gallery",
    description: "Create a three-stop day across an independent bookstore, a cafe, and a gallery.",
    linkedJournalEntryIds: [],
  },
];

export function generateSideQuest(journal: QuestJournalData, existingQuests: SideQuest[]): SideQuest {
  const drafts = [...journalBasedDrafts(journal), ...generalDrafts];
  const unusedDrafts = drafts.filter((draft) => !existingQuests.some((quest) => quest.templateId === draft.templateId && quest.status === "active"));
  const pool = unusedDrafts.length > 0 ? unusedDrafts : drafts;
  const draft = pool[existingQuests.length % pool.length];
  const now = new Date().toISOString();

  return {
    id: `quest:${createUuid()}`,
    ...draft,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}
