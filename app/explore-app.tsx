"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatPersonalRating, type PersonalRating } from "@/lib/journal";
import { categoryMeta, type Place, type PlaceSearchResult } from "@/lib/places";
import { JournalEntryActions } from "./journal-entry-actions";
import { JournalEntryForm, type JournalEntryFormValues } from "./journal-entry-form";
import { useJournal } from "./journal-provider";
import { ResponsiveAppShell } from "./responsive-app-shell";
import { saveLogPlaceSelection } from "@/lib/log-place-selection";

const dateFormatter = new Intl.DateTimeFormat("en", { year: "numeric", month: "long", day: "numeric" });
const shortDateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });
const distance = (meters?: number) => meters === undefined ? "Nearby" : meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1)} km`;
const defaultSearchCoordinates = { lat: 39.9042, lng: 116.4074 };
type JournalFilterName = "categories" | "people" | "rating";

function JournalFilterDropdown({ id, label, count, openFilter, setOpenFilter, className = "", children }: { id: JournalFilterName; label: string; count: number; openFilter: JournalFilterName | null; setOpenFilter: (value: JournalFilterName | null) => void; className?: string; children: ReactNode }) {
  const isOpen = openFilter === id;
  return <div className={`journal-filter ${className} ${isOpen ? "open" : ""}`}><button type="button" className="journal-filter-trigger" aria-expanded={isOpen} aria-controls={`journal-filter-${id}`} onClick={() => setOpenFilter(isOpen ? null : id)}>{label}{count > 0 && <b>{count}</b>}<span>⌄</span></button>{isOpen && <div className="journal-filter-menu" id={`journal-filter-${id}`}>{children}</div>}</div>;
}

function Pin({ place, active, onClick }: { place: Place; active: boolean; onClick: () => void }) {
  const x = Math.min(88, Math.max(12, 50 + (place.coordinates.lng - 116.4074) * 520));
  const y = Math.min(88, Math.max(15, 50 - (place.coordinates.lat - 39.9042) * 620));
  return <button className={`map-pin ${active ? "active" : ""}`} style={{ left: `${x}%`, top: `${y}%` }} onClick={onClick} aria-label={`Show ${place.name}`}><span>{categoryMeta[place.category].icon}</span></button>;
}

export function ExploreApp({ initialMode = "journal" }: { initialMode?: "journal" | "log" }) {
  const router = useRouter();
  const { journal, updateJournal } = useJournal();
  const [mode, setMode] = useState<"journal" | "log">(initialMode);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchCoordinates, setSearchCoordinates] = useState(defaultSearchCoordinates);
  const [hasCurrentLocation, setHasCurrentLocation] = useState(false);
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([]);
  const [selectedSearchPlace, setSelectedSearchPlace] = useState<Place | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [journalQuery, setJournalQuery] = useState("");
  const [categoryFilterIds, setCategoryFilterIds] = useState<string[]>([]);
  const [personFilterIds, setPersonFilterIds] = useState<string[]>([]);
  const [ratingFilters, setRatingFilters] = useState<PersonalRating[]>([]);
  const [openFilter, setOpenFilter] = useState<JournalFilterName | null>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);
  const searchRequestRef = useRef<AbortController | null>(null);
  const searchTimerRef = useRef<number | null>(null);

  useEffect(() => {
    function closeFilters(event: PointerEvent) {
      if (!filterBarRef.current?.contains(event.target as Node)) setOpenFilter(null);
    }
    document.addEventListener("pointerdown", closeFilters);
    return () => document.removeEventListener("pointerdown", closeFilters);
  }, []);

  useEffect(() => {
    if (mode !== "log" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setSearchCoordinates({ lat: coords.latitude, lng: coords.longitude });
        setHasCurrentLocation(true);
      },
      () => {
        setSearchCoordinates(defaultSearchCoordinates);
        setHasCurrentLocation(false);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  }, [mode]);

  const runPlaceSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery) return;
    searchRequestRef.current?.abort();
    const controller = new AbortController();
    searchRequestRef.current = controller;
    setIsLoading(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams({ q: searchQuery, lat: String(searchCoordinates.lat), lng: String(searchCoordinates.lng), nearby: hasCurrentLocation ? "1" : "0" });
      const response = await fetch(`/api/places/search?${params}`, { signal: controller.signal });
      const data = (await response.json()) as { places?: PlaceSearchResult[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Place search failed");
      setSearchResults(data.places ?? []);
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        setSearchResults([]);
        setSearchError(error.message);
      }
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, [searchCoordinates, hasCurrentLocation]);

  useEffect(() => {
    if (mode !== "log" || !query.trim()) return;
    searchTimerRef.current = window.setTimeout(() => runPlaceSearch(query.trim()), 350);
    return () => {
      if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    };
  }, [query, mode, runPlaceSearch]);

  useEffect(() => () => searchRequestRef.current?.abort(), []);

  function submitPlaceSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = null;
    void runPlaceSearch(query.trim());
  }

  const sortedEntries = useMemo(() => [...journal.entries].sort((a, b) => b.visitedAt.localeCompare(a.visitedAt)), [journal.entries]);
  const filteredEntries = useMemo(() => sortedEntries.filter((entry) => {
    const place = journal.places[entry.placeId];
    const search = journalQuery.trim().toLocaleLowerCase();
    const providerTerms = place ? [
      place.category,
      ...place.aliases,
      ...place.providerCategories.flatMap((item) => [item.name, item.nameLocal]),
      ...place.providerTags.flatMap((item) => [item.name, item.nameLocal]),
    ] : [];
    const matchesSearch = !search || [place?.name, place?.nameLocal, place?.address, entry.notes, ...providerTerms].some((value) => value?.toLocaleLowerCase().includes(search));
    const matchesCategory = categoryFilterIds.length === 0 || categoryFilterIds.some((id) => entry.categoryIds.includes(id));
    const matchesPerson = personFilterIds.length === 0 || personFilterIds.some((id) => entry.personIds.includes(id));
    const matchesRating = ratingFilters.length === 0 || (entry.rating !== undefined && ratingFilters.includes(entry.rating));
    return matchesSearch && matchesCategory && matchesPerson && matchesRating;
  }), [sortedEntries, journal.places, journalQuery, categoryFilterIds, personFilterIds, ratingFilters]);
  const uniquePlaceIds = useMemo(() => Array.from(new Set(journal.entries.map((entry) => entry.placeId))), [journal.entries]);
  const journalMapPlaceIds = useMemo(() => Array.from(new Set(filteredEntries.filter((entry) => entry.access !== "shared").map((entry) => entry.placeId))), [filteredEntries]);
  const journalMapPlaces = journalMapPlaceIds.map((id) => journal.places[id]).filter((place): place is Place => Boolean(place));
  const activeEntry = filteredEntries.find((entry) => entry.id === activeEntryId) ?? filteredEntries[0] ?? null;
  const activeJournalPlace = activeEntry ? journal.places[activeEntry.placeId] : null;
  const activeCategories = activeEntry ? journal.categories.filter((item) => activeEntry.categoryIds.includes(item.id)) : [];
  const activePeople = activeEntry ? journal.people.filter((item) => activeEntry.personIds.includes(item.id)) : [];
  const placeVisitCount = activeJournalPlace ? journal.entries.filter((entry) => entry.placeId === activeJournalPlace.id).length : 0;
  const searchPlaces = useMemo(() => searchResults.map((result) => result.place), [searchResults]);
  const searchDistanceByPlaceId = useMemo(() => new Map(searchResults.map((result) => [result.place.id, result.distanceMeters])), [searchResults]);
  const mapPlaces = mode === "journal" ? journalMapPlaces : searchPlaces;
  const selectedPlace = mode === "journal" ? activeJournalPlace : selectedSearchPlace;

  function openJournal() {
    setMode("journal");
    setEditingEntryId(null);
  }

  function openLogger() {
    setMode("log");
    setEditingEntryId(null);
  }

  function selectJournalPlace(place: Place) {
    const latest = sortedEntries.find((entry) => entry.placeId === place.id);
    if (latest) {
      setActiveEntryId(latest.id);
      setEditingEntryId(null);
    }
  }

  function toggleId<T extends string | number>(id: T, values: T[], setValues: (next: T[]) => void) {
    setValues(values.includes(id) ? values.filter((value) => value !== id) : [...values, id]);
  }

  function continueToMemory() {
    if (!selectedSearchPlace) return;
    saveLogPlaceSelection(selectedSearchPlace);
    router.push(`/log?place=${encodeURIComponent(selectedSearchPlace.id)}`);
  }

  function changePlace() {
    setSelectedSearchPlace(null);
  }

  function saveEntryEdits(values: JournalEntryFormValues) {
    if (!editingEntryId) return;
    updateJournal((current) => ({
      ...current,
      entries: current.entries.map((entry) => entry.id === editingEntryId ? {
        ...entry,
        ...values,
        updatedAt: new Date().toISOString(),
      } : entry),
    }));
    setEditingEntryId(null);
  }

  return <ResponsiveAppShell active="log"><main className="app-shell">
    <aside className="sidebar">
      <header className="brand-row"><button className="brand" onClick={openJournal}><span className="brand-mark">E</span><span>Explore</span></button><button className="avatar">AJ</button></header>
      <nav className="primary-nav" aria-label="Main navigation">
        <button className={mode === "journal" ? "active" : ""} onClick={openJournal}><span>◷</span> Journal <b>{journal.entries.length}</b></button>
        <Link href="/map"><span>⌖</span> Map <b>{uniquePlaceIds.length}</b></Link>
        <Link href="/collections"><span>▦</span> Collections <b>{journal.categories.length}</b></Link>
        <Link href="/side-quests"><span>◇</span> Side Quests <b>{journal.sideQuests.filter((quest) => quest.status === "active").length}</b></Link>
        <button className={mode === "log" ? "active" : ""} onClick={openLogger}><span>＋</span> Log a place</button>
      </nav>
      <div className="sidebar-bottom"><div className="tiny-map"><span>•</span><i /></div><div><strong>Beijing</strong><small>{uniquePlaceIds.length} places remembered</small></div><button>⌄</button></div>
    </aside>

    <section className="content-panel">
      <div className="mobile-header"><button className="brand" onClick={openJournal}><span className="brand-mark">E</span><span>Explore</span></button><button className="avatar">AJ</button></div>

      {mode === "journal" ? <>
        <div className="journal-hero"><div><p className="eyebrow">MY TRAVEL DIARY</p><h1>Places become stories.</h1><p>A personal record of where you went and what stayed with you.</p></div><button className="log-place-cta" onClick={openLogger}><span>＋</span> Log a place</button></div>
        <div className="journal-stats"><div><strong>{uniquePlaceIds.length}</strong><span>places visited</span></div><div><strong>{journal.entries.length}</strong><span>memories logged</span></div></div>
        <label className="journal-search"><span>⌕</span><input value={journalQuery} onChange={(event) => setJournalQuery(event.target.value)} placeholder="Search places, addresses, and notes…" />{journalQuery && <button type="button" onClick={() => setJournalQuery("")} aria-label="Clear journal search">×</button>}</label>
        <div className="journal-filters" ref={filterBarRef}>
          {journal.categories.length > 0 && <JournalFilterDropdown id="categories" label="Categories" count={categoryFilterIds.length} openFilter={openFilter} setOpenFilter={setOpenFilter}>{journal.categories.map((item) => <button key={item.id} className={categoryFilterIds.includes(item.id) ? "active" : ""} onClick={() => toggleId(item.id, categoryFilterIds, setCategoryFilterIds)}>{item.name}</button>)}</JournalFilterDropdown>}
          {journal.people.length > 0 && <JournalFilterDropdown id="people" label="People" count={personFilterIds.length} openFilter={openFilter} setOpenFilter={setOpenFilter}>{journal.people.map((item) => <button key={item.id} className={personFilterIds.includes(item.id) ? "active" : ""} onClick={() => toggleId(item.id, personFilterIds, setPersonFilterIds)}>{item.name}</button>)}</JournalFilterDropdown>}
          <JournalFilterDropdown id="rating" label="Rating" count={ratingFilters.length} openFilter={openFilter} setOpenFilter={setOpenFilter} className="rating-filter">{([5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5] as PersonalRating[]).map((rating) => <button key={rating} className={ratingFilters.includes(rating) ? "active" : ""} onClick={() => toggleId(rating, ratingFilters, setRatingFilters)}>{formatPersonalRating(rating)} <small>{rating}</small></button>)}</JournalFilterDropdown>
          {(journalQuery || categoryFilterIds.length > 0 || personFilterIds.length > 0 || ratingFilters.length > 0) && <button className="clear-filters" onClick={() => { setJournalQuery(""); setCategoryFilterIds([]); setPersonFilterIds([]); setRatingFilters([]); }}>Clear all</button>}
        </div>
        <div className="results-title"><strong>Recent journal entries</strong><span>{filteredEntries.length} entries</span></div>
        <div className="entry-list">
          {filteredEntries.map((entry) => {
            const place = journal.places[entry.placeId];
            if (!place) return null;
            return <button key={entry.id} className={`entry-card ${entry.access === "shared" ? "shared-visit" : ""} ${activeEntry?.id === entry.id ? "selected" : ""}`} onClick={() => { setActiveEntryId(entry.id); setEditingEntryId(null); }}>
              <div className={`entry-icon art-${place.category}`}>{categoryMeta[place.category].icon}</div>
              <div><div className="entry-title"><strong>{place.name}</strong><time>{shortDateFormatter.format(new Date(entry.visitedAt))}</time></div>{entry.access === "shared" && <span className="shared-memory-label">Shared by {entry.ownerDisplayName ?? `@${entry.ownerUsername ?? "Explore user"}`} · read only</span>}<span className="personal-stars">{formatPersonalRating(entry.rating)}</span><p>{entry.notes || "A visit worth remembering."}</p></div><span className="card-arrow">›</span>
            </button>;
          })}
          {!filteredEntries.length && <div className="empty-state journal-empty"><span>✎</span><strong>{journal.entries.length ? "No memories match" : "Your journal begins here"}</strong><p>{journal.entries.length ? "Try clearing one of your filters." : "Log a place you have visited, then add the memory you want to keep."}</p>{!journal.entries.length && <button onClick={openLogger}>Log your first place</button>}</div>}
        </div>
      </> : <>
        <div className="content-heading"><p className="eyebrow">LOG A PLACE · 北京</p><h1>Where have you been?</h1><p>Find the place on AMap, then add your visit to the journal.</p></div>
        {selectedSearchPlace ? <div className="place-confirmation">
          <article className="selected-place-card">
            <div className="selected-place-heading"><div className={`selected-place-icon art-${selectedSearchPlace.category}`}>{categoryMeta[selectedSearchPlace.category].icon}</div><div><p className="eyebrow">SELECTED PLACE</p><h2>{selectedSearchPlace.name}</h2>{selectedSearchPlace.nameLocal && selectedSearchPlace.nameLocal !== selectedSearchPlace.name && <p className="local-name">{selectedSearchPlace.nameLocal}</p>}</div></div>
            <div className="detail-topline"><span>{selectedSearchPlace.categoryLabel}</span><small>{distance(searchDistanceByPlaceId.get(selectedSearchPlace.id))} away</small></div>
            {selectedSearchPlace.providerRating && <div className="rating-line"><b>★ {selectedSearchPlace.providerRating}</b><span>AMap rating</span></div>}
            <p className="address">⌖ <span>{selectedSearchPlace.address}</span></p>
            <button type="button" className="change-place" onClick={changePlace}>← Change place</button>
          </article>
          <button className="directions create-memory" onClick={continueToMemory}>Create memory <span>→</span></button>
        </div> : <>
          <form className="search-box" role="search" onSubmit={submitPlaceSearch}><span>⌕</span><input type="search" enterKeyHint="search" aria-label="Search for a place" value={query} onChange={(event) => { const nextQuery = event.target.value; setQuery(nextQuery); if (!nextQuery.trim()) { searchRequestRef.current?.abort(); setSearchResults([]); setSearchError(null); setIsLoading(false); } }} placeholder="Search for a place you visited…" autoFocus /><kbd>⌘ K</kbd><button type="submit" className="place-search-submit" disabled={!query.trim() || isLoading}>{isLoading ? "Searching…" : "Search"}</button></form>
          <div className="results-title"><strong>{query ? `Results for “${query}”` : "Search for an exact place"}</strong><span>{searchPlaces.length} places</span></div>
          <div className="place-list">
            {searchPlaces.map((place) => <button key={place.id} className="place-card" onClick={() => setSelectedSearchPlace(place)}><div className={`place-art art-${place.category}`}><span>{categoryMeta[place.category].icon}</span></div><div className="place-copy"><div className="place-name"><strong>{place.name}</strong><small>{place.nameLocal}</small></div><p>{place.categoryLabel} · {distance(searchDistanceByPlaceId.get(place.id))}</p>{place.providerRating && <div><b>★ {place.providerRating}</b></div>}</div><span className="card-arrow">›</span></button>)}
            {!searchPlaces.length && <div className="empty-state"><span>⌖</span><strong>{isLoading ? "Searching AMap…" : searchError ? "Search unavailable" : query.trim() ? "No places found" : "Search for a place you visited"}</strong><p>{searchError || (query.trim() ? "Try the exact venue name or address." : "Results will be ordered from nearest to farthest when location is available.")}</p></div>}
          </div>
        </>}
      </>}
    </section>

    <section className="map-panel" aria-label={mode === "journal" ? "Map of journal places" : "Map of AMap search results"}>
      <div className="map-canvas"><div className="river" /><div className="road road-one" /><div className="road road-two" /><div className="road road-three" /><div className="road road-four" /><span className="district d-one">XICHENG</span><span className="district d-two">DONGCHENG</span><span className="district d-three">CHAOYANG</span><span className="water-label">Beijing · 北京</span>
        {mapPlaces.map((place) => <Pin key={place.id} place={place} active={selectedPlace?.id === place.id} onClick={() => mode === "journal" ? selectJournalPlace(place) : setSelectedSearchPlace(place)} />)}
        <div className="map-tools"><button aria-label="Locate me">◎</button><button aria-label="Zoom in">＋</button><button aria-label="Zoom out">−</button></div><div className="map-provider">高德地图 · AMap</div>
      </div>

      {mode === "journal" && activeEntry && activeJournalPlace && <article className={`detail-card memory-card ${activeEntry.access === "shared" ? "shared-visit" : ""}`}><div className="memory-heading"><p className="memory-kicker">{activeEntry.access === "shared" ? "SHARED MEMORY · READ ONLY" : editingEntryId === activeEntry.id ? "EDIT MEMORY" : "RECENT MEMORY"}</p>{editingEntryId !== activeEntry.id && <JournalEntryActions entryId={activeEntry.id} placeName={activeJournalPlace.name} onEdit={() => setEditingEntryId(activeEntry.id)} onDeleted={() => { setActiveEntryId(null); setEditingEntryId(null); }} />}</div><h2>{activeJournalPlace.name}</h2><p className="address">⌖ <span>{activeJournalPlace.address}</span></p>{activeEntry.access === "shared" && <span className="shared-memory-label">Shared by {activeEntry.ownerDisplayName ?? `@${activeEntry.ownerUsername ?? "Explore user"}`} · participant access</span>}{editingEntryId === activeEntry.id ? <JournalEntryForm key={activeEntry.id} entry={activeEntry} onSubmit={saveEntryEdits} onCancel={() => setEditingEntryId(null)} submitLabel="Save changes" /> : <><div className="memory-date"><time>{dateFormatter.format(new Date(activeEntry.visitedAt))}</time><span>{formatPersonalRating(activeEntry.rating)}</span></div>{(activeCategories.length > 0 || activePeople.length > 0) && <div className="memory-metadata">{activeCategories.map((item) => <span className="category-chip" key={item.id}># {item.name}</span>)}{activePeople.map((item) => <span className="person-chip" key={item.id}>@ {item.name}</span>)}</div>}<blockquote>{activeEntry.notes || "No notes were added for this visit."}</blockquote><div className="memory-footer"><span>{placeVisitCount} {placeVisitCount === 1 ? "visit" : "visits"} to this place</span><button onClick={openLogger}>Log another visit</button></div></>}</article>}

    </section>

    <nav className="mobile-nav"><button className={mode === "journal" ? "active" : ""} onClick={openJournal}><span>◷</span>Journal</button><Link href="/map"><span>⌖</span>Map</Link><Link href="/side-quests"><span>◇</span>Quests</Link><button className={mode === "log" ? "active" : ""} onClick={openLogger}><span>＋</span>Log place</button></nav>
  </main></ResponsiveAppShell>;
}
