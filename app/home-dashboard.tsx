"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { JournalEntryActions } from "@/app/journal-entry-actions";
import { JournalEntryForm, type JournalEntryFormValues } from "@/app/journal-entry-form";
import { formatPersonalRating } from "@/lib/journal";
import { useJournal } from "@/app/journal-provider";
import { categoryMeta } from "@/lib/places";
import { generateSideQuest } from "@/lib/side-quests";
import { ResponsiveAppShell } from "@/app/responsive-app-shell";
import { useAuth } from "@/app/auth-provider";

const shortDateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });
const longDateFormatter = new Intl.DateTimeFormat("en", { month: "long", day: "numeric", year: "numeric" });

export function HomeDashboard() {
  const { journal, isLoaded, updateJournal } = useJournal();
  const { initials } = useAuth();
  const [showAllPlaces, setShowAllPlaces] = useState(false);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

  const sortedEntries = useMemo(() => [...journal.entries].sort((a, b) => b.visitedAt.localeCompare(a.visitedAt)), [journal.entries]);
  const placeGroups = useMemo(() => Array.from(new Set(sortedEntries.map((entry) => entry.placeId))).map((placeId) => ({
    place: journal.places[placeId],
    entries: sortedEntries.filter((entry) => entry.placeId === placeId),
  })).filter((group) => Boolean(group.place)), [journal.places, sortedEntries]);
  const activeQuest = journal.sideQuests.filter((quest) => quest.status === "active").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const selectedGroup = placeGroups.find(({ place }) => place.id === selectedPlaceId) ?? placeGroups[0];
  const visibleEntries = showAllPlaces ? sortedEntries : sortedEntries.slice(0, 4);

  function generateQuest() {
    updateJournal((current) => ({
      ...current,
      sideQuests: [generateSideQuest(current, current.sideQuests), ...current.sideQuests],
    }));
  }

  function saveEntryEdits(entryId: string, values: JournalEntryFormValues) {
    updateJournal((current) => ({
      ...current,
      entries: current.entries.map((entry) => entry.id === entryId ? { ...entry, ...values, updatedAt: new Date().toISOString() } : entry),
    }));
    setEditingEntryId(null);
  }

  return <ResponsiveAppShell active="home"><main className="home-dashboard-shell">
    <aside className="sidebar home-sidebar">
      <header className="brand-row"><Link className="brand" href="/"><span className="brand-mark">E</span><span>Explore</span></Link><Link className="avatar" href="/profile">{initials}</Link></header>
      <nav className="primary-nav" aria-label="Main navigation">
        <Link className="active" href="/"><span>⌂</span> Home</Link>
        <Link href="/collections"><span>▦</span> Collections <b>{journal.categories.length}</b></Link>
        <Link href="/map"><span>⌖</span> Map <b>{placeGroups.length}</b></Link>
        <Link href="/side-quests"><span>◇</span> Side Quests <b>{journal.sideQuests.filter((quest) => quest.status === "active").length}</b></Link>
        <Link href="/profile"><span>○</span> Profile & Friends</Link>
      </nav>
      <div className="sidebar-bottom"><div className="tiny-map"><span>•</span><i /></div><div><strong>My place journal</strong><small>{placeGroups.length} places remembered</small></div></div>
    </aside>

    <section className="home-dashboard">
      <header className="home-mobile-header"><Link className="brand" href="/"><span className="brand-mark">E</span><span>Explore</span></Link><Link className="avatar" href="/profile">{initials}</Link></header>
      <section className="home-intro"><p className="eyebrow">MY PLACE JOURNAL</p><h1>Home</h1></section>

      <section className="home-actions" aria-label="Quick actions">
        <Link className="home-action primary" href="/?mode=log"><span>＋</span><div><strong>Log a place</strong><small>Add a visit and memory</small></div><b>›</b></Link>
        <button className="home-action" onClick={generateQuest}><span>◇</span><div><strong>Generate side quest</strong><small>Find a reason to wander</small></div><b>›</b></button>
      </section>

      <section className="home-current-quest"><div className="home-section-title"><div><p className="eyebrow">YOUR NEXT ADVENTURE</p><h2>Current Quest</h2></div>{activeQuest && <Link href="/side-quests">Open quests →</Link>}</div>{activeQuest ? <article className="home-quest"><h3>{activeQuest.title}</h3><p>{activeQuest.description}</p></article> : <div className="home-quest-empty"><p>No active quest yet.</p><button onClick={generateQuest}>Generate a side quest</button></div>}</section>

      <div className="home-journal-grid">
        <section className="home-recent"><div className="home-section-title"><div><p className="eyebrow">YOUR JOURNAL</p><h2>Recent Memories</h2></div>{sortedEntries.length > 4 && <button onClick={() => setShowAllPlaces((current) => !current)}>{showAllPlaces ? "Show less" : "View more"}</button>}</div>
          {!isLoaded ? <div className="home-empty"><span>◷</span><p>Opening your journal…</p></div> : visibleEntries.length === 0 ? <div className="home-empty"><span>⌖</span><h3>Your journal begins with one place.</h3><p>Log somewhere you have been and keep the part you want to remember.</p><Link href="/?mode=log">Log your first place</Link></div> : <div className="home-place-list">{visibleEntries.map((entry) => {
            const place = journal.places[entry.placeId];
            if (!place) return null;
            const visits = placeGroups.find((group) => group.place.id === place.id)?.entries.length ?? 1;
            const categories = journal.categories.filter((item) => entry.categoryIds.includes(item.id));
            const people = journal.people.filter((item) => entry.personIds.includes(item.id));
            return <button className={`home-place-card ${selectedPlaceId === place.id ? "selected" : ""}`} key={entry.id} onClick={() => { setSelectedPlaceId(place.id); setEditingEntryId(null); }}><div className={`home-place-icon art-${place.category}`}>{categoryMeta[place.category].icon}</div><div className="home-place-copy"><div><h3>{place.name}</h3><time>{shortDateFormatter.format(new Date(entry.visitedAt))}</time></div><div className="home-place-meta"><span className="personal-stars">{formatPersonalRating(entry.rating)}</span><span>{visits} {visits === 1 ? "visit" : "visits"}</span></div>{(categories.length > 0 || people.length > 0) && <div className="home-place-tags">{categories.slice(0, 2).map((item) => <span key={item.id}># {item.name}</span>)}{people.slice(0, 2).map((item) => <span className="person" key={item.id}>@ {item.name}</span>)}</div>}<p>{entry.notes || "A visit worth remembering."}</p></div><span className="card-arrow">›</span></button>;
          })}</div>}
        </section>

        {selectedGroup && <aside className={`home-place-detail ${selectedPlaceId ? "mobile-open" : ""}`}><button className="home-detail-close" onClick={() => { setSelectedPlaceId(null); setEditingEntryId(null); }} aria-label="Close place story">×</button><div className="home-detail-heading"><div><p className="eyebrow">PLACE STORY</p><h2>{selectedGroup.place.name}</h2><p>{selectedGroup.place.address}</p></div><strong>{selectedGroup.entries.length}<span>{selectedGroup.entries.length === 1 ? "visit" : "visits"}</span></strong></div><div className="home-visit-list">{selectedGroup.entries.map((entry) => <article key={entry.id}>{editingEntryId === entry.id ? <JournalEntryForm entry={entry} onSubmit={(values) => saveEntryEdits(entry.id, values)} onCancel={() => setEditingEntryId(null)} submitLabel="Save changes" /> : <><div className="home-visit-heading"><div><time>{longDateFormatter.format(new Date(entry.visitedAt))}</time><span>{formatPersonalRating(entry.rating)}</span></div><JournalEntryActions entryId={entry.id} placeName={selectedGroup.place.name} onEdit={() => setEditingEntryId(entry.id)} onDeleted={() => setEditingEntryId(null)} /></div><p>{entry.notes || "No notes were added for this visit."}</p></>}</article>)}</div></aside>}
      </div>
    </section>

    <nav className="home-bottom-nav" aria-label="Primary mobile navigation"><Link className="active" href="/"><span>⌂</span>Home</Link><Link href="/collections"><span>▦</span>Collections</Link><Link href="/map"><span>⌖</span>Map</Link><Link href="/profile"><span>○</span>Profile</Link></nav>
  </main></ResponsiveAppShell>;
}
