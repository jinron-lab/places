"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useJournal } from "@/app/journal-provider";
import { loadAMap, type AMapMap } from "@/lib/amap-js";
import { formatPersonalRating } from "@/lib/journal";
import { ResponsiveAppShell } from "@/app/responsive-app-shell";

const dateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });
const amapKey = process.env.NEXT_PUBLIC_AMAP_JS_API_KEY ?? "";
const amapSecurityCode = process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE ?? "";
const cityZoom = 11;
const maximumAutomaticZoom = 11;

function getCurrentCoordinates() {
  if (!navigator.geolocation) return Promise.resolve<[number, number] | null>(null);
  return new Promise<[number, number] | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve([coords.longitude, coords.latitude]),
      () => resolve(null),
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 4_000 },
    );
  });
}

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
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapMap | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const ownedEntries = useMemo(() => journal.entries.filter((entry) => entry.access !== "shared"), [journal.entries]);
  const visitedPlaces = useMemo(() => Array.from(new Set(ownedEntries.map((entry) => entry.placeId))).map((placeId) => ({
    place: journal.places[placeId],
    entries: ownedEntries.filter((entry) => entry.placeId === placeId).sort((a, b) => b.visitedAt.localeCompare(a.visitedAt)),
  })).filter((item) => Boolean(item.place)), [ownedEntries, journal.places]);

  const selectedPlace = selectedPlaceId
    ? visitedPlaces.find((item) => item.place.id === selectedPlaceId)
    : undefined;
  const latestVisit = selectedPlace?.entries[0];

  useEffect(() => {
    // Keep app-owned sizing separate from AMap's SDK-owned .amap-container
    // class, whose stylesheet is injected when the SDK becomes ready.
    containerRef.current?.classList.add("visited-amap-host");
  }, []);

  useEffect(() => {
    const blockedReasons = [
      pathname !== "/map" && "route-not-map",
      !isLoaded && "journal-not-loaded",
      !containerRef.current && "container-missing",
      !amapKey && "api-key-missing",
      !amapSecurityCode && "security-code-missing",
      visitedPlaces.length === 0 && "no-visited-places",
    ].filter(Boolean);
    if (blockedReasons.length > 0) return;
    let cancelled = false;
    let createdMap: AMapMap | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let layoutFrame = 0;
    let resizeFrame = 0;
    let mapLifecycleCleanup: (() => void) | null = null;
    const settleTimers: number[] = [];
    const container = containerRef.current!;

    function waitForContainerSize() {
      return new Promise<void>((resolve) => {
        let previousWidth = 0;
        let previousHeight = 0;
        let stableFrames = 0;
        const checkSize = () => {
          if (cancelled) {
            return resolve();
          }
          const bounds = container.getBoundingClientRect();
          const width = Math.round(bounds.width);
          const height = Math.round(bounds.height);
          if (container.isConnected && width > 0 && height > 0) {
            stableFrames = width === previousWidth && height === previousHeight ? stableFrames + 1 : 0;
            previousWidth = width;
            previousHeight = height;
            if (stableFrames >= 2) {
              return resolve();
            }
          } else {
            stableFrames = 0;
          }
          layoutFrame = window.requestAnimationFrame(checkSize);
        };
        checkSize();
      });
    }

    function refreshMapView(markers: Parameters<AMapMap["setFitView"]>[0], fitMarkers: boolean) {
      if (!createdMap || cancelled) return;
      const bounds = container.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      createdMap.resize();
      if (fitMarkers) createdMap.setFitView(markers, false, [70, 430, 70, 70], maximumAutomaticZoom);
    }

    function scheduleResize() {
      if (!createdMap || cancelled) return;
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        if (!createdMap || cancelled) return;
        createdMap.resize();
      });
    }

    async function initializeMap() {
      setMapError(null);
      // Loading the SDK can outlast an interim route layout. Wait for it first,
      // then measure the final client-navigation layout immediately before
      // constructing the map so a previously valid size cannot go stale.
      const [AMap, currentCoordinates] = await Promise.all([
        loadAMap(amapKey, amapSecurityCode),
        getCurrentCoordinates(),
      ]);
      if (cancelled || containerRef.current !== container) return;
      let initializationBounds: DOMRect;
      while (true) {
        await waitForContainerSize();
        if (cancelled || containerRef.current !== container) return;
        initializationBounds = container.getBoundingClientRect();
        if (container.isConnected && initializationBounds.width > 0 && initializationBounds.height > 0) {
          break;
        }
      }
      const first = visitedPlaces[0].place.coordinates;
      const initialCenter: [number, number] = currentCoordinates ?? [first.lng, first.lat];
      const map = new AMap.Map(container, { zoom: cityZoom, center: initialCenter, resizeEnable: true, viewMode: "2D" });
      createdMap = map;
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
      // When location is unavailable, fit multiple places into view without
      // ever zooming closer than the city-level starting scale. A single
      // marker deliberately keeps the same broad exploration viewport.
      const shouldFitMarkers = currentCoordinates === null && markers.length > 1;
      if (shouldFitMarkers) map.setFitView(markers, false, [70, 430, 70, 70], maximumAutomaticZoom);
      mapRef.current = map;

      resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleResize);
      resizeObserver?.observe(container);
      window.addEventListener("resize", scheduleResize);
      window.visualViewport?.addEventListener("resize", scheduleResize);
      const handlePageShow = () => refreshMapView(markers, shouldFitMarkers);
      const handleVisibilityChange = () => {
        if (document.visibilityState === "visible") refreshMapView(markers, shouldFitMarkers);
      };
      window.addEventListener("pageshow", handlePageShow);
      document.addEventListener("visibilitychange", handleVisibilityChange);

      // Client navigation and standalone PWA chrome can settle over several
      // frames. These bounded passes recover if AMap sampled an interim size.
      for (const delay of [0, 100, 350, 1000]) {
        settleTimers.push(window.setTimeout(() => refreshMapView(markers, shouldFitMarkers), delay));
      }

      // Store listener cleanup alongside the map lifetime.
      mapLifecycleCleanup = () => {
        window.removeEventListener("pageshow", handlePageShow);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      };
    }

    void initializeMap().catch((error: unknown) => {
      if (!cancelled) setMapError(error instanceof Error ? error.message : "Unable to load AMap");
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(layoutFrame);
      window.cancelAnimationFrame(resizeFrame);
      settleTimers.forEach((timer) => window.clearTimeout(timer));
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleResize);
      window.visualViewport?.removeEventListener("resize", scheduleResize);
      mapLifecycleCleanup?.();
      mapLifecycleCleanup = null;
      createdMap?.destroy();
      if (mapRef.current === createdMap) mapRef.current = null;
    };
  }, [isLoaded, pathname, visitedPlaces]);

  const needsConfiguration = !amapKey || !amapSecurityCode;

  return <ResponsiveAppShell active="map">
    <main className="visited-map-shell">
      <MapSidebar />
      <section className="visited-map-page">
        <div ref={containerRef} className="amap-container" />
        {!isLoaded && <div className="map-state"><strong>Loading your journal…</strong></div>}
        {isLoaded && needsConfiguration && <div className="map-state"><strong>Connect the AMap JS API</strong><p>Add the browser map key and security code shown in <code>.env.example</code>, then restart the app.</p></div>}
        {isLoaded && !needsConfiguration && visitedPlaces.length === 0 && <div className="map-state"><strong>No visited places yet</strong><p>Log a visit and its stored coordinates will appear here.</p><Link href="/?mode=log">Log a place</Link></div>}
        {mapError && <div className="map-state"><strong>Map unavailable</strong><p>{mapError}</p></div>}
        {selectedPlace && latestVisit && <aside className="visited-place-card" aria-label={`${selectedPlace.place.name} visit details`}>
          <div className="visited-place-heading">
            <div><p>VISITED PLACE</p><h2>{selectedPlace.place.name}</h2></div>
            <strong>{selectedPlace.entries.length}<span>{selectedPlace.entries.length === 1 ? "visit" : "visits"}</span></strong>
            <button className="visited-place-close" type="button" aria-label="Close place details" onClick={() => setSelectedPlaceId(null)}>×</button>
          </div>
          <p className="address">⌖ <span>{selectedPlace.place.address}</span></p>
          <div className="map-memory-list">
            <article>
              <div><time>{dateFormatter.format(new Date(latestVisit.visitedAt))}</time><span>{formatPersonalRating(latestVisit.rating)}</span></div>
              <p>{latestVisit.notes || "No notes were added for this visit."}</p>
            </article>
          </div>
        </aside>}
        <div className="map-attribution">高德地图 · AMap</div>
      </section>
      <MapMobileNav />
    </main>
  </ResponsiveAppShell>;
}
