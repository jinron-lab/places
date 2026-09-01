"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useJournal } from "@/app/journal-provider";
import { JournalEntryActions } from "@/app/journal-entry-actions";
import { JournalEntryForm, type JournalEntryFormValues } from "@/app/journal-entry-form";
import { formatPersonalRating } from "@/lib/journal";
import { categoryMeta } from "@/lib/places";
import { ResponsiveAppShell } from "@/app/responsive-app-shell";
import { ALL_PLACES_COLLECTION_ID, getVisiblePlaceGroups } from "@/lib/journal-views";

const dateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });

function CollectionsSidebar() {
  const { journal } = useJournal();
  return <aside className="sidebar">
    <header className="brand-row"><Link className="brand" href="/"><span className="brand-mark">E</span><span>Explore</span></Link><button className="avatar">AJ</button></header>
    <nav className="primary-nav" aria-label="Main navigation">
      <Link href="/"><span>◷</span> Journal <b>{journal.entries.length}</b></Link>
      <Link href="/map"><span>⌖</span> Map <b>{new Set(journal.entries.filter((entry) => entry.access !== "shared").map((entry) => entry.placeId)).size}</b></Link>
      <Link className="active" href="/collections"><span>▦</span> Collections <b>{journal.categories.length + 1}</b></Link>
      <Link href="/side-quests"><span>◇</span> Side Quests <b>{journal.sideQuests.filter((quest) => quest.status === "active").length}</b></Link>
      <Link href="/?mode=log"><span>＋</span> Log a place</Link>
    </nav>
    <div className="sidebar-bottom"><div className="tiny-map"><span>•</span><i /></div><div><strong>Beijing</strong><small>{journal.categories.length} collections</small></div></div>
  </aside>;
}

function CollectionsMobileNav() {
  return <nav className="mobile-nav"><Link href="/"><span>◷</span>Journal</Link><Link href="/map"><span>⌖</span>Map</Link><Link className="active" href="/collections"><span>▦</span>Collections</Link><Link href="/side-quests"><span>◇</span>Quests</Link></nav>;
}

export function CollectionsIndex() {
  const { journal } = useJournal();
  const allPlaces = getVisiblePlaceGroups(journal);

  return <ResponsiveAppShell active="collections"><main className="collections-shell"><CollectionsSidebar /><section className="collections-panel"><div className="mobile-header"><Link className="brand" href="/"><span className="brand-mark">E</span><span>Explore</span></Link><button className="avatar">AJ</button></div><header className="collections-heading"><p className="eyebrow">MY COLLECTIONS</p><h1>Places, gathered by meaning.</h1><p>All Places is your complete journal view. Your own collections remain organized by category.</p></header><div className="collection-grid"><Link href={`/collections/${ALL_PLACES_COLLECTION_ID}`} className="collection-card all-places-card"><div className="collection-color all-places-color"><span>⌖</span></div><div><h2>All Places</h2><p>{allPlaces.length} {allPlaces.length === 1 ? "place" : "places"} · permanent</p><span className="collection-card-action">View all places →</span></div><span className="card-arrow">›</span></Link>{journal.categories.map((category) => { const count = journal.entries.filter((entry) => entry.categoryIds.includes(category.id)).length; return <Link href={`/collections/${category.id}`} className="collection-card" key={category.id}><div className="collection-color" style={{ backgroundColor: category.color }}>{category.icon && <span>{category.icon}</span>}</div><div><h2>{category.name}</h2><p>{count} {count === 1 ? "journal entry" : "journal entries"}</p><span className="collection-card-action">View collection →</span></div><span className="card-arrow">›</span></Link>; })}</div>{journal.categories.length === 0 && <div className="collections-inline-empty"><p>No custom collections yet. Create one while logging or editing a visit.</p><Link href="/?mode=log">Log a place</Link></div>}</section><CollectionsMobileNav /></main></ResponsiveAppShell>;
}

export function CollectionDetail({ categoryId }: { categoryId: string }) {
  const router = useRouter();
  const { journal, isLoaded, updateJournal } = useJournal();
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState("#315b46");
  const [draftIcon, setDraftIcon] = useState("");
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  let normalizedCategoryId = categoryId;
  try {
    normalizedCategoryId = decodeURIComponent(categoryId);
  } catch {}
  const category = journal.categories.find((item) => item.id === normalizedCategoryId);
  const entries = journal.entries.filter((entry) => entry.categoryIds.includes(normalizedCategoryId)).sort((a, b) => b.visitedAt.localeCompare(a.visitedAt));

  function beginEditing() {
    if (!category) return;
    setDraftName(category.name);
    setDraftColor(category.color);
    setDraftIcon(category.icon ?? "");
    setIsEditing(true);
  }

  function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draftName.trim();
    if (!category || !name) return;
    updateJournal((current) => ({
      ...current,
      categories: current.categories.map((item) => item.id === category.id ? {
        ...item,
        name,
        color: draftColor,
        icon: draftIcon.trim() || undefined,
      } : item),
    }));
    setIsEditing(false);
  }

  function deleteCategory() {
    if (!category) return;
    const affectedEntries = journal.entries.filter((entry) => entry.categoryIds.includes(category.id)).length;
    const message = affectedEntries > 0
      ? `Delete “${category.name}”? ${affectedEntries} journal ${affectedEntries === 1 ? "entry" : "entries"} will be kept, but removed from this collection.`
      : `Delete “${category.name}”? Your journal entries will not be deleted.`;
    const confirmed = window.confirm(message);
    if (!confirmed) return;

    updateJournal((current) => ({
      ...current,
      categories: current.categories.filter((item) => item.id !== category.id),
      entries: current.entries.map((entry) => entry.categoryIds.includes(category.id)
        ? { ...entry, categoryIds: entry.categoryIds.filter((id) => id !== category.id), updatedAt: new Date().toISOString() }
        : entry),
    }), { deletedCategoryIds: [category.id] });
    router.push("/collections");
  }

  function saveEntryEdits(entryId: string, values: JournalEntryFormValues) {
    updateJournal((current) => ({
      ...current,
      entries: current.entries.map((entry) => entry.id === entryId ? {
        ...entry,
        ...values,
        updatedAt: new Date().toISOString(),
      } : entry),
    }));
    setEditingEntryId(null);
  }

  return <ResponsiveAppShell active="collections"><main className="collections-shell"><CollectionsSidebar /><section className="collections-panel"><div className="mobile-header"><Link className="brand" href="/"><span className="brand-mark">E</span><span>Explore</span></Link><button className="avatar">AJ</button></div>{!isLoaded ? <div className="collections-empty"><span>▦</span><h2>Loading collection…</h2></div> : category ? <><Link className="collections-back" href="/collections">← All collections</Link><div className="collection-detail-top"><header className="collection-detail-heading"><div className="collection-color large" style={{ backgroundColor: category.color }}>{category.icon && <span>{category.icon}</span>}</div><div><p className="eyebrow">COLLECTION</p><h1>{category.name}</h1><p>{entries.length} {entries.length === 1 ? "memory" : "memories"}</p></div></header><div className="collection-actions"><button type="button" onClick={beginEditing}>Edit collection</button><button type="button" className="danger" onClick={deleteCategory}>Delete</button></div></div>{isEditing && <form className="collection-edit-form" onSubmit={saveCategory}><label><span>Name</span><input value={draftName} onChange={(event) => setDraftName(event.target.value)} required /></label><label><span>Color</span><span className="color-field"><input type="color" value={draftColor} onChange={(event) => setDraftColor(event.target.value)} /><code>{draftColor}</code></span></label><label><span>Icon</span><input value={draftIcon} onChange={(event) => setDraftIcon(event.target.value)} placeholder="Optional emoji" maxLength={4} /></label><div className="collection-edit-actions"><button type="button" onClick={() => setIsEditing(false)}>Cancel</button><button type="submit" disabled={!draftName.trim()}>Save changes</button></div></form>}<div className="collection-entry-list">{entries.map((entry) => { const place = journal.places[entry.placeId]; if (!place) return null; const isEntryEditing = editingEntryId === entry.id; return <article className={`collection-entry ${isEntryEditing ? "editing" : ""}`} key={entry.id}><div className={`entry-icon art-${place.category}`}>{categoryMeta[place.category].icon}</div><div><div className="collection-entry-title"><div><h2>{place.name}</h2>{!isEntryEditing && <time>{dateFormatter.format(new Date(entry.visitedAt))}</time>}</div>{!isEntryEditing && <JournalEntryActions entryId={entry.id} placeName={place.name} onEdit={() => setEditingEntryId(entry.id)} onDeleted={() => setEditingEntryId(null)} />}</div>{isEntryEditing ? <JournalEntryForm key={entry.id} entry={entry} onSubmit={(values) => saveEntryEdits(entry.id, values)} onCancel={() => setEditingEntryId(null)} submitLabel="Save changes" /> : <><span className="personal-stars">{formatPersonalRating(entry.rating)}</span><p>{entry.notes || "No notes were added for this visit."}</p></>}</div></article>; })}</div></> : <div className="collections-empty"><span>?</span><h2>Collection not found</h2><p>This category may no longer exist on this device.</p><Link href="/collections">Back to collections</Link></div>}</section><CollectionsMobileNav /></main></ResponsiveAppShell>;
}

export function AllPlaces() {
  const { journal, isLoaded } = useJournal();
  const groups = getVisiblePlaceGroups(journal);

  return <ResponsiveAppShell active="collections"><main className="collections-shell"><CollectionsSidebar /><section className="collections-panel"><div className="mobile-header"><Link className="brand" href="/"><span className="brand-mark">E</span><span>Explore</span></Link><button className="avatar">AJ</button></div><Link className="collections-back" href="/collections">← All collections</Link><header className="collection-detail-heading all-places-heading"><div className="collection-color large all-places-color"><span>⌖</span></div><div><p className="eyebrow">PERMANENT COLLECTION</p><h1>All Places</h1><p>{groups.length} unique {groups.length === 1 ? "place" : "places"} across every visit visible in your journal</p></div></header>{!isLoaded ? <div className="collections-empty"><span>⌖</span><h2>Opening all places…</h2></div> : groups.length > 0 ? <div className="all-places-list">{groups.map(({ place, entries, latestVisit, hasSharedVisits }) => <Link className="all-place-card" href={`/collections/${ALL_PLACES_COLLECTION_ID}/${encodeURIComponent(place.id)}`} key={place.id}><div className={`entry-icon art-${place.category}`}>{categoryMeta[place.category].icon}</div><div><div className="all-place-title"><h2>{place.name}</h2>{hasSharedVisits && <span className="shared-memory-label">Includes shared visits</span>}</div><p>{place.address}</p><div className="all-place-meta"><span>{entries.length} {entries.length === 1 ? "visit" : "visits"}</span><time>Latest {dateFormatter.format(new Date(latestVisit.visitedAt))}</time></div></div><span className="card-arrow">›</span></Link>)}</div> : <div className="collections-empty"><span>⌖</span><h2>No places yet</h2><p>Places appear here after you log a visit or participate in a shared entry.</p><Link href="/?mode=log">Log a place</Link></div>}</section><CollectionsMobileNav /></main></ResponsiveAppShell>;
}

export function AllPlacesPlaceDetail({ placeId }: { placeId: string }) {
  const { journal, isLoaded, updateJournal } = useJournal();
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  let normalizedPlaceId = placeId;
  try { normalizedPlaceId = decodeURIComponent(placeId); } catch {}
  const group = getVisiblePlaceGroups(journal).find((item) => item.place.id === normalizedPlaceId);

  function saveEntryEdits(entryId: string, values: JournalEntryFormValues) {
    updateJournal((current) => ({
      ...current,
      entries: current.entries.map((entry) => entry.id === entryId ? { ...entry, ...values, updatedAt: new Date().toISOString() } : entry),
    }));
    setEditingEntryId(null);
  }

  return <ResponsiveAppShell active="collections"><main className="collections-shell"><CollectionsSidebar /><section className="collections-panel"><div className="mobile-header"><Link className="brand" href="/"><span className="brand-mark">E</span><span>Explore</span></Link><button className="avatar">AJ</button></div>{!isLoaded ? <div className="collections-empty"><span>⌖</span><h2>Opening place…</h2></div> : group ? <><Link className="collections-back" href={`/collections/${ALL_PLACES_COLLECTION_ID}`}>← All Places</Link><header className="place-detail-heading"><div className={`entry-icon art-${group.place.category}`}>{categoryMeta[group.place.category].icon}</div><div><p className="eyebrow">PLACE</p><h1>{group.place.name}</h1><p>{group.place.address}</p></div><strong>{group.entries.length}<span>{group.entries.length === 1 ? "visit" : "visits"}</span></strong></header><div className="collection-entry-list place-visit-list">{group.entries.map((entry) => { const isEditing = editingEntryId === entry.id; const owner = entry.ownerDisplayName ?? `@${entry.ownerUsername ?? "Explore user"}`; return <article className={`collection-entry ${isEditing ? "editing" : ""} ${entry.access === "shared" ? "shared-visit" : ""}`} key={entry.id}><div className={`entry-icon art-${group.place.category}`}>{categoryMeta[group.place.category].icon}</div><div><div className="collection-entry-title"><div><h2>{dateFormatter.format(new Date(entry.visitedAt))}</h2>{entry.access === "shared" && <span className="shared-memory-label">Shared by {owner} · read only</span>}</div>{!isEditing && <JournalEntryActions entryId={entry.id} placeName={group.place.name} onEdit={() => setEditingEntryId(entry.id)} onDeleted={() => setEditingEntryId(null)} />}</div>{isEditing ? <JournalEntryForm entry={entry} onSubmit={(values) => saveEntryEdits(entry.id, values)} onCancel={() => setEditingEntryId(null)} submitLabel="Save changes" /> : <><span className="personal-stars">{formatPersonalRating(entry.rating)}</span><p>{entry.notes || "No notes were added for this visit."}</p></>}</div></article>; })}</div></> : <div className="collections-empty"><span>?</span><h2>Place not found</h2><p>This place is not represented by an entry currently visible in your journal.</p><Link href={`/collections/${ALL_PLACES_COLLECTION_ID}`}>Back to All Places</Link></div>}</section><CollectionsMobileNav /></main></ResponsiveAppShell>;
}
