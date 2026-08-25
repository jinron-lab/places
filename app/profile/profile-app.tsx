"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ResponsiveAppShell } from "@/app/responsive-app-shell";
import { useAuth } from "@/app/auth-provider";
import { useJournal } from "@/app/journal-provider";
import { createJournalBackup } from "@/lib/journal-backup";
import { getSupabaseClient } from "@/lib/supabase";

type PublicProfile = { user_id: string; username: string; display_name: string; avatar_url: string | null };
type OwnProfile = PublicProfile & { searchable: boolean; profile_complete: boolean };
type FriendRequest = { id: string; requester_id: string; recipient_id: string; status: string; created_at: string };
type Friendship = { user_id_low: string; user_id_high: string; created_at: string };

function messageFrom(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
function initialsFor(profile: PublicProfile) { return profile.display_name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "○"; }

export function ProfileApp() {
  const { user, initials, signOut } = useAuth();
  const { journal, isLoaded } = useJournal();
  const userId = user?.id ?? "";
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, PublicProfile>>({});
  const [isSocialLoading, setIsSocialLoading] = useState(true);
  const [socialError, setSocialError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PublicProfile[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const loadSocial = useCallback(async () => {
    if (!userId) return;
    setIsSocialLoading(true); setSocialError("");
    try {
      const supabase = getSupabaseClient();
      const [profileResult, requestsResult, friendshipsResult] = await Promise.all([
        supabase.from("profiles").select("user_id, username, display_name, avatar_url, searchable, profile_complete").eq("user_id", userId).single(),
        supabase.from("friend_requests").select("id, requester_id, recipient_id, status, created_at").or(`requester_id.eq.${userId},recipient_id.eq.${userId}`).eq("status", "pending").order("created_at", { ascending: false }),
        supabase.from("friendships").select("user_id_low, user_id_high, created_at").or(`user_id_low.eq.${userId},user_id_high.eq.${userId}`).order("created_at", { ascending: false }),
      ]);
      if (profileResult.error) throw profileResult.error;
      if (requestsResult.error) throw requestsResult.error;
      if (friendshipsResult.error) throw friendshipsResult.error;
      const nextRequests = (requestsResult.data ?? []) as FriendRequest[];
      const nextFriendships = (friendshipsResult.data ?? []) as Friendship[];
      const relatedIds = Array.from(new Set([...nextRequests.flatMap((item) => [item.requester_id, item.recipient_id]), ...nextFriendships.flatMap((item) => [item.user_id_low, item.user_id_high])].filter((id) => id !== userId)));
      const relatedResult = relatedIds.length ? await supabase.from("profiles").select("user_id, username, display_name, avatar_url").in("user_id", relatedIds) : { data: [] as PublicProfile[], error: null };
      if (relatedResult.error) throw relatedResult.error;
      const nextProfile = profileResult.data as OwnProfile;
      setProfile(nextProfile); setUsername(nextProfile.username); setDisplayName(nextProfile.display_name);
      setIsEditingProfile(!nextProfile.profile_complete); setRequests(nextRequests); setFriendships(nextFriendships);
      setProfilesById(Object.fromEntries(((relatedResult.data ?? []) as PublicProfile[]).map((item) => [item.user_id, item])));
    } catch (error) { console.error("Explore profile and friendship loading failed.", error); setSocialError(messageFrom(error, "Profile and friends could not be loaded.")); }
    finally { setIsSocialLoading(false); }
  }, [userId]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void loadSocial(), 0);
    return () => window.clearTimeout(loadTimer);
  }, [loadSocial]);

  const incoming = requests.filter((item) => item.recipient_id === userId);
  const outgoing = requests.filter((item) => item.requester_id === userId);
  const friends = useMemo(() => friendships.map((friendship) => { const id = friendship.user_id_low === userId ? friendship.user_id_high : friendship.user_id_low; return { friendship, profile: profilesById[id] }; }).filter((item): item is { friendship: Friendship; profile: PublicProfile } => Boolean(item.profile)), [friendships, profilesById, userId]);
  const friendIds = useMemo(() => new Set(friends.map((item) => item.profile.user_id)), [friends]);
  const pendingIds = useMemo(() => new Set(requests.flatMap((item) => [item.requester_id, item.recipient_id]).filter((id) => id !== userId)), [requests, userId]);
  const selectedFriend = selectedFriendId ? profilesById[selectedFriendId] : null;
  const ownedEntries = journal.entries.filter((entry) => entry.access !== "shared");
  const placeCount = new Set(ownedEntries.map((entry) => entry.placeId)).size;

  async function runAction(key: string, action: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusyAction(key); setSocialError(""); setActionMessage("");
    try { const result = await action(); if (result.error) throw new Error(result.error.message); await loadSocial(); }
    catch (error) { console.error(`Explore friendship action failed: ${key}`, error); setSocialError(messageFrom(error, "The friendship action failed.")); }
    finally { setBusyAction(""); }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const searchTerm = query.trim().toLocaleLowerCase(); if (searchTerm.length < 2) return;
    setIsSearching(true); setHasSearched(true); setSocialError("");
    try { const { data, error } = await getSupabaseClient().rpc("search_explore_users", { p_query: searchTerm, p_limit: 20 }); if (error) throw error; setSearchResults((data ?? []) as PublicProfile[]); }
    catch (error) { console.error("Explore username search failed.", error); setSocialError(messageFrom(error, "User search failed.")); setSearchResults([]); }
    finally { setIsSearching(false); }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const nextUsername = username.trim().toLocaleLowerCase(); const nextName = displayName.trim();
    if (!/^[a-z0-9][a-z0-9_]{2,49}$/.test(nextUsername)) return setSocialError("Username must be 3–50 lowercase letters, numbers, or underscores.");
    if (!nextName || nextName.length > 80) return setSocialError("Display name must be 1–80 characters.");
    setBusyAction("profile"); setSocialError("");
    const { error } = await getSupabaseClient().from("profiles").update({ username: nextUsername, display_name: nextName, profile_complete: true }).eq("user_id", userId);
    setBusyAction(""); if (error) return setSocialError(error.message.includes("duplicate") ? "That username is already taken." : error.message);
    setActionMessage("Profile updated."); setIsEditingProfile(false); await loadSocial();
  }

  function exportBackup() { const blob = new Blob([JSON.stringify(createJournalBackup(journal), null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `explore-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url); setActionMessage("Backup exported."); }
  async function logout() { setIsSigningOut(true); try { await signOut(); } catch (error) { setSocialError(messageFrom(error, "Could not log out.")); setIsSigningOut(false); } }
  function profileCard(item: PublicProfile, actions?: ReactNode) { return <article className="social-person-card" key={item.user_id}><div className="social-avatar">{initialsFor(item)}</div><div><strong>{item.display_name}</strong><span>@{item.username}</span></div>{actions && <div className="social-card-actions">{actions}</div>}</article>; }

  return <ResponsiveAppShell active="profile"><main className="profile-page">
    <header className="profile-page-heading"><p className="eyebrow">PROFILE & FRIENDS</p><h1>Your corner of Explore.</h1><p>Manage your identity, account, and the people you choose to connect with.</p></header>
    {socialError && <div className="profile-alert error" role="alert">{socialError}<button type="button" onClick={() => void loadSocial()}>Retry</button></div>}{actionMessage && <div className="profile-alert success" role="status">{actionMessage}</div>}
    <section className="profile-identity-card"><div className="profile-identity-top"><div className="profile-page-avatar">{initials}</div><div><p className="eyebrow">EXPLORE IDENTITY</p><h2>{profile?.display_name ?? "Loading profile…"}</h2>{profile && <span>@{profile.username}</span>}</div>{profile && !isEditingProfile && <button type="button" onClick={() => setIsEditingProfile(true)}>Edit profile</button>}</div>{profile && !profile.profile_complete && <p className="profile-completion-note">Choose a username and display name so friends can find you.</p>}{profile && isEditingProfile && <form className="profile-identity-form" onSubmit={saveProfile}><label>Username<input value={username} onChange={(event) => setUsername(event.target.value.toLocaleLowerCase().replace(/[^a-z0-9_]/g, ""))} minLength={3} maxLength={50} required /></label><label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} required /></label><div><button type="button" onClick={() => { setUsername(profile.username); setDisplayName(profile.display_name); setIsEditingProfile(false); }} disabled={!profile.profile_complete}>Cancel</button><button type="submit" disabled={busyAction === "profile"}>{busyAction === "profile" ? "Saving…" : "Save profile"}</button></div></form>}<dl className="profile-stats"><div><dt>Places</dt><dd>{placeCount}</dd></div><div><dt>Visits</dt><dd>{ownedEntries.length}</dd></div><div><dt>Collections</dt><dd>{journal.categories.length}</dd></div><div><dt>Friends</dt><dd>{friends.length}</dd></div></dl></section>
    <section className="friends-section"><div className="profile-section-heading"><div><p className="eyebrow">FRIENDS</p><h2>Find your people.</h2></div><span>{friends.length}</span></div><form className="friend-search" onSubmit={search}><label htmlFor="friend-search">Search by username</label><div><span>@</span><input id="friend-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="username" minLength={2} autoComplete="off" /><button type="submit" disabled={isSearching || query.trim().length < 2}>{isSearching ? "Searching…" : "Search"}</button></div></form>
      {hasSearched && <div className="friend-search-results"><h3>Search results</h3>{searchResults.length === 0 && !isSearching ? <p className="social-empty">No users match that username.</p> : searchResults.map((item) => { const alreadyFriend = friendIds.has(item.user_id); const pending = pendingIds.has(item.user_id); return profileCard(item, <button type="button" disabled={alreadyFriend || pending || busyAction === `send:${item.user_id}`} onClick={() => void runAction(`send:${item.user_id}`, () => getSupabaseClient().rpc("send_friend_request", { p_recipient_id: item.user_id }))}>{alreadyFriend ? "Already friends" : pending ? "Request pending" : busyAction === `send:${item.user_id}` ? "Sending…" : "Add friend"}</button>); })}</div>}
      <div className="request-grid"><section><h3>Incoming requests <span>{incoming.length}</span></h3>{incoming.length === 0 ? <p className="social-empty">No incoming requests.</p> : incoming.map((request) => { const sender = profilesById[request.requester_id]; return sender ? profileCard(sender, <><button type="button" disabled={Boolean(busyAction)} onClick={() => void runAction(`accept:${request.id}`, () => getSupabaseClient().rpc("accept_friend_request", { p_request_id: request.id }))}>Accept</button><button type="button" className="secondary" disabled={Boolean(busyAction)} onClick={() => void runAction(`decline:${request.id}`, () => getSupabaseClient().rpc("decline_friend_request", { p_request_id: request.id }))}>Decline</button></>) : null; })}</section><section><h3>Sent requests <span>{outgoing.length}</span></h3>{outgoing.length === 0 ? <p className="social-empty">No pending sent requests.</p> : outgoing.map((request) => { const recipient = profilesById[request.recipient_id]; return recipient ? profileCard(recipient, <button type="button" className="secondary" disabled={Boolean(busyAction)} onClick={() => void runAction(`cancel:${request.id}`, () => getSupabaseClient().rpc("cancel_friend_request", { p_request_id: request.id }))}>Cancel</button>) : null; })}</section></div>
      <div className="accepted-friends"><h3>Your friends</h3>{isSocialLoading ? <p className="social-empty">Loading friends…</p> : friends.length === 0 ? <p className="social-empty">No friends yet. Search for an Explore username to send your first request.</p> : friends.map(({ profile: friend }) => profileCard(friend, <><button type="button" className="secondary" onClick={() => setSelectedFriendId(selectedFriendId === friend.user_id ? null : friend.user_id)}>View friend</button><button type="button" className="danger" disabled={Boolean(busyAction)} onClick={() => { if (window.confirm(`Unfriend @${friend.username}?`)) void runAction(`unfriend:${friend.user_id}`, () => getSupabaseClient().rpc("unfriend_explore_user", { p_friend_user_id: friend.user_id })).then(() => setSelectedFriendId(null)); }}>Unfriend</button></>))}</div>{selectedFriend && <aside className="friend-detail"><button type="button" onClick={() => setSelectedFriendId(null)} aria-label="Close friend profile">×</button><div className="social-avatar large">{initialsFor(selectedFriend)}</div><p className="eyebrow">EXPLORE FRIEND</p><h3>{selectedFriend.display_name}</h3><span>@{selectedFriend.username}</span><p>Friendship does not share private journal entries or map history.</p></aside>}
    </section>
    <section className="account-settings"><div><p className="eyebrow">ACCOUNT</p><h2>Settings & recovery</h2><p>Signed in as <strong>{user?.email}</strong>. Email is never shown in user search.</p></div><div className="account-actions"><button type="button" onClick={exportBackup} disabled={!isLoaded}>Export journal JSON</button><button type="button" disabled title="Cloud restore is temporarily disabled">Import unavailable</button><button type="button" className="danger" onClick={logout} disabled={isSigningOut}>{isSigningOut ? "Logging out…" : "Log out"}</button></div></section>
  </main></ResponsiveAppShell>;
}
