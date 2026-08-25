"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useJournal } from "@/app/journal-provider";
import { ResponsiveAppShell } from "@/app/responsive-app-shell";
import { formatPersonalRating, type JournalEntry } from "@/lib/journal";
import { categoryMeta } from "@/lib/places";

const dateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });

function personEntries(personId: string, entries: JournalEntry[]) {
  return entries.filter((entry) => entry.personIds.includes(personId)).sort((a, b) => b.visitedAt.localeCompare(a.visitedAt));
}

export function PeopleIndex() {
  const { journal, isLoaded } = useJournal();

  return <ResponsiveAppShell active="people"><main className="people-page"><header className="people-heading"><p className="eyebrow">PEOPLE</p><h1>Places are better together.</h1><p>The people connected to your memories, and the places you shared.</p></header>{!isLoaded ? <div className="people-empty"><span>♙</span><h2>Opening your people…</h2></div> : journal.people.length > 0 ? <div className="people-grid">{journal.people.map((person) => {
    const entries = personEntries(person.id, journal.entries);
    const placeCount = new Set(entries.map((entry) => entry.placeId)).size;
    const latest = entries[0];
    const latestPlace = latest ? journal.places[latest.placeId] : undefined;
    return <Link className="person-card" href={`/people/${encodeURIComponent(person.id)}`} key={person.id}><div className="person-avatar">{person.name.trim().charAt(0).toLocaleUpperCase() || "○"}</div><div className="person-card-copy"><h2>{person.name}</h2><div className="person-stats"><span><strong>{entries.length}</strong> {entries.length === 1 ? "memory" : "memories"}</span><span><strong>{placeCount}</strong> {placeCount === 1 ? "place" : "places"}</span></div>{latest && latestPlace ? <p>Latest: {latestPlace.name} · {dateFormatter.format(new Date(latest.visitedAt))}</p> : <p>No shared visits yet</p>}</div><span className="card-arrow">›</span></Link>;
  })}</div> : <div className="people-empty"><span>♙</span><h2>No people yet</h2><p>Add people while creating or editing a memory. They will appear here automatically.</p><Link href="/?mode=log">Log a place</Link></div>}</main></ResponsiveAppShell>;
}

export function PersonDetail({ personId }: { personId: string }) {
  const router = useRouter();
  const { journal, isLoaded, updateJournal } = useJournal();
  let normalizedPersonId = personId;
  try { normalizedPersonId = decodeURIComponent(personId); } catch {}
  const person = journal.people.find((item) => item.id === normalizedPersonId);
  const entries = personEntries(normalizedPersonId, journal.entries);
  const places = Array.from(new Set(entries.map((entry) => entry.placeId))).map((placeId) => ({ place: journal.places[placeId], visits: entries.filter((entry) => entry.placeId === placeId) })).filter((item) => Boolean(item.place));

  function deletePerson() {
    if (!person) return;
    const affectedEntries = journal.entries.filter((entry) => entry.personIds.includes(person.id)).length;
    const message = affectedEntries > 0
      ? `Delete “${person.name}”? ${affectedEntries} journal ${affectedEntries === 1 ? "entry" : "entries"} will be kept, but this person will be removed from them.`
      : `Delete “${person.name}”? Your journal entries will not be deleted.`;
    if (!window.confirm(message)) return;

    updateJournal((current) => ({
      ...current,
      people: current.people.filter((item) => item.id !== person.id),
      entries: current.entries.map((entry) => entry.personIds.includes(person.id)
        ? { ...entry, personIds: entry.personIds.filter((id) => id !== person.id), updatedAt: new Date().toISOString() }
        : entry),
    }), { deletedPersonIds: [person.id] });
    router.push("/people");
  }

  return <ResponsiveAppShell active="people"><main className="people-page">{!isLoaded ? <div className="people-empty"><span>♙</span><h2>Opening this person…</h2></div> : person ? <><Link className="people-back" href="/people">← All people</Link><div className="person-detail-top"><header className="person-detail-heading"><div className="person-avatar large">{person.name.trim().charAt(0).toLocaleUpperCase() || "○"}</div><div><p className="eyebrow">SHARED MEMORIES</p><h1>{person.name}</h1><p>{entries.length} {entries.length === 1 ? "memory" : "memories"} across {places.length} {places.length === 1 ? "place" : "places"}</p></div></header><button type="button" className="person-delete" onClick={deletePerson}>Delete person</button></div><section className="shared-places" aria-labelledby="shared-places-title"><h2 id="shared-places-title">Places visited together</h2>{places.length > 0 ? <div>{places.map(({ place, visits }) => <article key={place.id}><div className={`shared-place-icon art-${place.category}`}>{categoryMeta[place.category].icon}</div><div><h3>{place.name}</h3><p>{place.address}</p></div><strong>{visits.length}<span>{visits.length === 1 ? "visit" : "visits"}</span></strong></article>)}</div> : <p className="people-muted">No shared places yet.</p>}</section><section className="person-memory-section" aria-labelledby="person-memories-title"><h2 id="person-memories-title">Related journal entries</h2>{entries.length > 0 ? <div className="person-memory-list">{entries.map((entry) => { const place = journal.places[entry.placeId]; if (!place) return null; return <article key={entry.id}><div className="person-memory-meta"><div><h3>{place.name}</h3><time>{dateFormatter.format(new Date(entry.visitedAt))}</time></div><span>{formatPersonalRating(entry.rating)}</span></div><p>{entry.notes || "No notes were added for this visit."}</p></article>; })}</div> : <p className="people-muted">No journal entries are linked to this person yet.</p>}</section></> : <div className="people-empty"><span>?</span><h2>Person not found</h2><p>This person may no longer exist in your journal.</p><Link href="/people">Back to people</Link></div>}</main></ResponsiveAppShell>;
}
