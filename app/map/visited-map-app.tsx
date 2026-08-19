"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useJournal } from "@/app/journal-provider";
import { loadAMap, type AMapMap } from "@/lib/amap-js";
import { formatPersonalRating } from "@/lib/journal";
import { ResponsiveAppShell } from "@/app/responsive-app-shell";

const dateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });
const amapKey = process.env.NEXT_PUBLIC_AMAP_JS_API_KEY ?? "";
const amapSecurityCode = process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE ?? "";

function MapSidebar() {
  const { journal } = useJournal();
  const placeCount = new Set(journal.entries.map((entry) => entry.placeId)).size;
  return <aside className="sidebar">
    <header className="brand-row"><Link className="brand" href="/"><span className="brand-mark">E</span><span>Explore</span></Link><button className="avatar">AJ</button></header>
    <nav className="primary-nav" aria-label="Main navigation">
      <Link href="/"><span>◷</span> Journal <b>{journal.entries.length}</b></Link>
      <Link className="active" href="/map"><span>⌖</span> Map <b>{placeCount}</b></Link>
      <Link href="/collections"><span>▦</span> Collections <b>{journal.categories.length}</b></Link>
      <Link href="/side-quests"><span>◇</span> Side Quests <b>{journal.sideQuests.filter((quest) => quest.status === "active").length}</b></Link>
      <Link href="/?mode=log"><span>＋</span> Log a place</Link>
    </nav>
    <div className="sidebar-bottom"><div className="tiny-map"><span>•</span><i /></div><div><strong>My world</strong><small>{placeCount} visited places</small></div></div>
  </aside>;
}

function MapMobileNav() {
  return <nav className="mobile-nav"><Link href="/"><span>◷</span>Journal</Link><Link className="active" href="/map"><span>⌖</span>Map</Link><Link href="/collections"><span>▦</span>Collections</Link><Link href="/side-quests"><span>◇</span>Quests</Link></nav>;
}

export function VisitedMapApp() {
  const { journal, isLoaded } = useJournal();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapMap | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const visitedPlaces = useMemo(() => Array.from(new Set(journal.entries.map((entry) => entry.placeId))).map((placeId) => ({
    place: journal.places[placeId],
    entries: journal.entries.filter((entry) => entry.placeId === placeId).sort((a, b) => b.visitedAt.localeCompare(a.visitedAt)),
  })).filter((item) => Boolean(item.place)), [journal.entries, journal.places]);

  const activePlaceId = selectedPlaceId && visitedPlaces.some((item) => item.place.id === selectedPlaceId) ? selectedPlaceId : visitedPlaces[0]?.place.id;
  const activePlace = visitedPlaces.find((item) => item.place.id === activePlaceId);

  useEffect(() => {
    if (!isLoaded || !containerRef.current || !amapKey || !amapSecurityCode || visitedPlaces.length === 0) return;
    let cancelled = false;

    loadAMap(amapKey, amapSecurityCode).then((AMap) => {
      if (cancelled || !containerRef.current) return;
      const first = visitedPlaces[0].place.coordinates;
      const map = new AMap.Map(containerRef.current, { zoom: 11, center: [first.lng, first.lat], resizeEnable: true, viewMode: "2D" });
      const markers = visitedPlaces.map(({ place, entries }) => {
        const marker = new AMap.Marker({
          position: [place.coordinates.lng, place.coordinates.lat],
          title: place.name,
          content: `<button class="visited-marker" aria-label="${entries.length} visits"><span>${entries.length}</span></button>`,
          anchor: "bottom-center",
        });
        marker.on("click", () => setSelectedPlaceId(place.id));
        return marker;
      });
      map.add(markers);
      map.setFitView(markers, false, [70, 430, 70, 70]);
      mapRef.current = map;
    }).catch((error: unknown) => {
      if (!cancelled) setMapError(error instanceof Error ? error.message : "Unable to load AMap");
    });

    return () => {
      cancelled = true;
      mapRef.current?.destroy();
      mapRef.current = null;
    };
  }, [isLoaded, visitedPlaces]);

  const needsConfiguration = !amapKey || !amapSecurityCode;

  return <ResponsiveAppShell active="map"><main className="visited-map-shell"><MapSidebar /><section className="visited-map-page"><div className="mobile-header"><Link className="brand" href="/"><span className="brand-mark">E</span><span>Explore</span></Link><button className="avatar">AJ</button></div><div ref={containerRef} className="amap-container" />{!isLoaded && <div className="map-state"><strong>Loading your journal…</strong></div>}{isLoaded && needsConfiguration && <div className="map-state"><strong>Connect the AMap JS API</strong><p>Add the browser map key and security code shown in <code>.env.example</code>, then restart the app.</p></div>}{isLoaded && !needsConfiguration && visitedPlaces.length === 0 && <div className="map-state"><strong>No visited places yet</strong><p>Log a visit and its stored coordinates will appear here.</p><Link href="/?mode=log">Log a place</Link></div>}{mapError && <div className="map-state"><strong>Map unavailable</strong><p>{mapError}</p></div>}<header className="visited-map-heading"><p>MY VISITED MAP</p><h1>{visitedPlaces.length} {visitedPlaces.length === 1 ? "place" : "places"}, remembered.</h1></header>{activePlace && <aside className="visited-place-card"><div className="visited-place-heading"><div><p>VISITED PLACE</p><h2>{activePlace.place.name}</h2></div><strong>{activePlace.entries.length}<span>{activePlace.entries.length === 1 ? "visit" : "visits"}</span></strong></div><p className="address">⌖ <span>{activePlace.place.address}</span></p><div className="map-memory-list">{activePlace.entries.slice(0, 3).map((entry) => <article key={entry.id}><div><time>{dateFormatter.format(new Date(entry.visitedAt))}</time><span>{formatPersonalRating(entry.rating)}</span></div><p>{entry.notes || "No notes were added for this visit."}</p></article>)}</div>{activePlace.entries.length > 3 && <small>Showing the 3 most recent visits</small>}</aside>}<div className="map-attribution">高德地图 · AMap</div></section><MapMobileNav /></main></ResponsiveAppShell>;
}
