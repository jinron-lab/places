"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { JournalEntryForm, type JournalEntryFormValues } from "@/app/journal-entry-form";
import { useJournal } from "@/app/journal-provider";
import { ResponsiveAppShell } from "@/app/responsive-app-shell";
import type { JournalEntry } from "@/lib/journal";
import { createUuid } from "@/lib/id";
import { categoryMeta } from "@/lib/places";
import { clearLogPlaceSelection, readLogPlaceSelection } from "@/lib/log-place-selection";

export function LogPlaceApp({ selectedPlaceId }: { selectedPlaceId?: string }) {
  const router = useRouter();
  const { updateJournal } = useJournal();
  const selectionLoaded = useSyncExternalStore(() => () => {}, () => true, () => false);
  const place = useSyncExternalStore(() => () => {}, () => readLogPlaceSelection(selectedPlaceId), () => null);

  function saveMemory(values: JournalEntryFormValues) {
    if (!place) return;
    const now = new Date().toISOString();
    const entry: JournalEntry = { id: createUuid(), placeId: place.id, ...values, createdAt: now, updatedAt: now };
    console.info("[journal-create-debug] Create entry function called", {
      entryId: entry.id,
      placeId: entry.placeId,
      visitedAt: entry.visitedAt,
      rating: entry.rating ?? null,
      hasNotes: Boolean(entry.notes),
      categoryCount: entry.categoryIds.length,
      personCount: entry.personIds.length,
    });
    updateJournal((current) => ({ ...current, entries: [entry, ...current.entries], places: { ...current.places, [place.id]: place } }));
    clearLogPlaceSelection();
    router.push("/");
  }

  return <ResponsiveAppShell active="log"><main className="log-memory-page"><header className="log-memory-header"><Link href="/?mode=log">← Back to search</Link><p className="eyebrow">NEW MEMORY</p><h1>Remember this visit.</h1><p>Add the details that made this place matter to you.</p></header>{!selectionLoaded ? <div className="log-memory-empty"><span>◷</span><h2>Opening your place…</h2></div> : place ? <div className="log-memory-layout"><section className="log-selected-place"><div className={`log-place-icon art-${place.category}`}>{categoryMeta[place.category].icon}</div><div><p className="eyebrow">SELECTED PLACE</p><h2>{place.name}</h2>{place.nameLocal && place.nameLocal !== place.name && <p className="log-local-name">{place.nameLocal}</p>}<p className="address">⌖ <span>{place.address}</span></p><span className="log-place-category">{place.categoryLabel}</span></div><Link href="/?mode=log">Change place</Link></section><section className="log-memory-form-card"><JournalEntryForm onSubmit={saveMemory} onCancel={() => router.push("/")} submitLabel="Save memory" /></section></div> : <div className="log-memory-empty"><span>⌖</span><h2>No place selected</h2><p>Search AMap and choose the exact place before creating your memory.</p><Link href="/?mode=log">Choose a place</Link></div>}</main></ResponsiveAppShell>;
}
