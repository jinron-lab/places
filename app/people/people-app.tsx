"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/auth-provider";
import { useJournal } from "@/app/journal-provider";
import { ResponsiveAppShell } from "@/app/responsive-app-shell";
import { formatPersonalRating, type JournalEntry } from "@/lib/journal";
import { categoryMeta } from "@/lib/places";
import { getSupabaseClient } from "@/lib/supabase";
import { JournalEntryActions } from "@/app/journal-entry-actions";

const dateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });

function personEntries(personId: string, entries: JournalEntry[]) {
  return entries.filter((entry) => entry.personIds.includes(personId)).sort((a, b) => b.visitedAt.localeCompare(a.visitedAt));
}

type FriendProfile = { user_id: string; username: string; display_name: string };
type FriendshipRow = { user_id_low: string; user_id_high: string };

function useAcceptedFriends() {
  const { user } = useAuth();
  const userId = user?.id;
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [error, setError] = useState("");
  const loadFriends = useCallback(async () => {
    if (!userId) return;
    setError("");
    const supabase = getSupabaseClient();
    const { data, error: friendshipError } = await supabase.from("friendships").select("user_id_low, user_id_high").or(`user_id_low.eq.${userId},user_id_high.eq.${userId}`);
    if (friendshipError) return setError(friendshipError.message);
    const ids = ((data ?? []) as FriendshipRow[]).map((row) => row.user_id_low === userId ? row.user_id_high : row.user_id_low);
    if (ids.length === 0) return setFriends([]);
    const { data: profiles, error: profileError } = await supabase.from("profiles").select("user_id, username, display_name").in("user_id", ids);
    if (profileError) return setError(profileError.message);
    setFriends((profiles ?? []) as FriendProfile[]);
  }, [userId]);
  useEffect(() => { const timer = window.setTimeout(() => void loadFriends(), 0); return () => window.clearTimeout(timer); }, [loadFriends]);
  return { friends, error };
}

export function PeopleIndex() {
  const { journal, isLoaded } = useJournal();

  return <ResponsiveAppShell active="people"><main className="people-page"><header className="people-heading"><p className="eyebrow">PEOPLE</p><h1>Places are better together.</h1><p>The people connected to your memories, and the places you shared.</p></header>{!isLoaded ? <div className="people-empty"><span>♙</span><h2>Opening your people…</h2></div> : journal.people.length > 0 ? <div className="people-grid">{journal.people.map((person) => {
    const entries = personEntries(person.id, journal.entries);
    const placeCount = new Set(entries.map((entry) => entry.placeId)).size;
    const latest = entries[0];
    const latestPlace = latest ? journal.places[latest.placeId] : undefined;
    return <Link className="person-card" href={`/people/${encodeURIComponent(person.id)}`} key={person.id}><div className="person-avatar">{person.name.trim().charAt(0).toLocaleUpperCase() || "○"}</div><div className="person-card-copy"><h2>{person.name}</h2>{person.linkedUserId && <span className="linked-account-badge">Linked to @{person.linkedUsername ?? "friend"}</span>}<div className="person-stats"><span><strong>{entries.length}</strong> {entries.length === 1 ? "memory" : "memories"}</span><span><strong>{placeCount}</strong> {placeCount === 1 ? "place" : "places"}</span></div>{latest && latestPlace ? <p>Latest: {latestPlace.name} · {dateFormatter.format(new Date(latest.visitedAt))}</p> : <p>No shared visits yet</p>}</div><span className="card-arrow">›</span></Link>;
  })}</div> : <div className="people-empty"><span>♙</span><h2>No people yet</h2><p>Add people while creating or editing a memory. They will appear here automatically.</p><Link href="/?mode=log">Log a place</Link></div>}</main></ResponsiveAppShell>;
}

export function PersonDetail({ personId }: { personId: string }) {
  const router = useRouter();
  const { journal, isLoaded, updateJournal } = useJournal();
  const { friends, error: friendsError } = useAcceptedFriends();
  let normalizedPersonId = personId;
  try { normalizedPersonId = decodeURIComponent(personId); } catch {}
  const person = journal.people.find((item) => item.id === normalizedPersonId);
  const taggedEntries = personEntries(normalizedPersonId, journal.entries);
  const linkedSharedEntries = person?.linkedUserId
    ? journal.entries.filter((entry) => entry.access === "shared" && entry.ownerId === person.linkedUserId)
    : [];
  const entries = Array.from(new Map([...taggedEntries, ...linkedSharedEntries].map((entry) => [entry.id, entry])).values())
    .sort((a, b) => b.visitedAt.localeCompare(a.visitedAt));
  const places = Array.from(new Set(entries.map((entry) => entry.placeId))).map((placeId) => ({ place: journal.places[placeId], visits: entries.filter((entry) => entry.placeId === placeId) })).filter((item) => Boolean(item.place));

  function setLinkedFriend(linkedUserId: string) {
    if (!person) return;
    const friend = friends.find((item) => item.user_id === linkedUserId);
    updateJournal((current) => ({
      ...current,
      people: current.people.map((item) => item.id === person.id ? {
        ...item,
        linkedUserId: friend?.user_id,
        linkedAt: friend ? new Date().toISOString() : undefined,
        linkedUsername: friend?.username,
        linkedDisplayName: friend?.display_name,
      } : item),
    }));
  }

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

  return <ResponsiveAppShell active="people"><main className="people-page">{!isLoaded ? <div className="people-empty"><span>♙</span><h2>Opening this person…</h2></div> : person ? <><Link className="people-back" href="/people">← All people</Link><div className="person-detail-top"><header className="person-detail-heading"><div className="person-avatar large">{person.name.trim().charAt(0).toLocaleUpperCase() || "○"}</div><div><p className="eyebrow">PERSON TAG</p><h1>{person.name}</h1><p>{entries.length} visible {entries.length === 1 ? "memory" : "memories"} across {places.length} {places.length === 1 ? "place" : "places"}</p></div></header><button type="button" className="person-delete" onClick={deletePerson}>Delete person</button></div><section className="person-link-card"><div><p className="eyebrow">EXPLORE FRIENDSHIP</p><h2>{person.linkedUserId ? `Linked to @${person.linkedUsername ?? "friend"}` : "Link this Person tag to a friend"}</h2><p>Friendship alone reveals no journal history. Only entries explicitly shared through participant access appear here; existing entries are never shared automatically.</p></div><label>Accepted friend<select value={person.linkedUserId ?? ""} onChange={(event) => setLinkedFriend(event.target.value)}><option value="">Not linked</option>{friends.map((friend) => <option key={friend.user_id} value={friend.user_id}>{friend.display_name} (@{friend.username})</option>)}</select></label>{friendsError && <p className="people-link-error">Friends could not be loaded: {friendsError}</p>}</section><section className="shared-places" aria-labelledby="shared-places-title"><h2 id="shared-places-title">Visible places involving {person.name}</h2>{places.length > 0 ? <div>{places.map(({ place, visits }) => <article key={place.id}><div className={`shared-place-icon art-${place.category}`}>{categoryMeta[place.category].icon}</div><div><h3>{place.name}</h3><p>{place.address}</p>{visits.some((entry) => entry.access === "shared") && <span className="shared-memory-label">Includes participant-shared visit</span>}</div><strong>{visits.length}<span>{visits.length === 1 ? "visit" : "visits"}</span></strong></article>)}</div> : <p className="people-muted">No authorized places are connected to this Person tag or linked account.</p>}</section><section className="person-memory-section" aria-labelledby="person-memories-title"><h2 id="person-memories-title">Related journal entries</h2>{entries.length > 0 ? <div className="person-memory-list">{entries.map((entry) => { const place = journal.places[entry.placeId]; if (!place) return null; const isLinkedAccountShare = !entry.personIds.includes(person.id); return <article className={entry.access === "shared" ? "shared-visit" : ""} key={entry.id}><div className="person-memory-meta"><div><h3>{place.name}</h3><time>{dateFormatter.format(new Date(entry.visitedAt))}</time></div><span>{formatPersonalRating(entry.rating)}</span></div><div className="person-entry-context"><span className={isLinkedAccountShare ? "explore-share-badge" : "person-tag-badge"}>{isLinkedAccountShare ? "Explore participant access" : `Person tag: ${person.name}`}</span>{entry.access === "shared" && <span className="shared-memory-label">Shared by {entry.ownerDisplayName ?? `@${entry.ownerUsername ?? "Explore user"}`} · read only</span>}</div><p>{entry.notes || "No notes were added for this visit."}</p>{entry.access === "shared" && <JournalEntryActions entryId={entry.id} placeName={place.name} onEdit={() => {}} />}</article>; })}</div> : <p className="people-muted">No authorized journal entries are connected to this Person tag or linked account.</p>}</section></> : <div className="people-empty"><span>?</span><h2>Person not found</h2><p>This person may no longer exist in your journal.</p><Link href="/people">Back to people</Link></div>}</main></ResponsiveAppShell>;
}
