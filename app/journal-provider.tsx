"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  createEmptyJournalStore,
  readLocalSideQuests,
  readJournalStore,
  writeLocalSideQuests,
  writeJournalStore,
  type JournalStore,
} from "@/lib/journal-storage";
import {
  hasCloudData,
  loadSupabaseJournalStore,
  persistSupabaseJournalStore,
} from "@/lib/journal-supabase";
import { useAuth } from "@/app/auth-provider";

type JournalUpdate = JournalStore | ((current: JournalStore) => JournalStore);
const LEGACY_CLOUD_OWNER_KEY = "explore.journal.legacy-cloud-owner";

type JournalContextValue = {
  journal: JournalStore;
  isLoaded: boolean;
  updateJournal: (update: JournalUpdate) => void;
};

const JournalContext = createContext<JournalContextValue | null>(null);

export function JournalProvider({ children }: { children: ReactNode }) {
  const { user, isAuthLoaded } = useAuth();
  const userId = user?.id;
  const [journal, setJournal] = useState(createEmptyJournalStore);
  const [isLoaded, setIsLoaded] = useState(false);
  const persistenceMode = useRef<"loading" | "supabase" | "local">("loading");
  const writeQueue = useRef(Promise.resolve());

  useEffect(() => {
    if (!isAuthLoaded || !userId) {
      persistenceMode.current = "loading";
      return;
    }
    const authenticatedUserId = userId;
    let cancelled = false;

    async function loadJournal() {
      // This provider can survive an account switch before navigation completes.
      // Clear the previous account's in-memory view before doing any I/O.
      await Promise.resolve();
      if (cancelled) return;
      setJournal(createEmptyJournalStore());
      setIsLoaded(false);
      // Keep the legacy read and migration until a Supabase load has succeeded.
      const localJournal = readJournalStore();

      try {
        let cloudJournal = await loadSupabaseJournalStore(authenticatedUserId);
        const legacyOwner = window.localStorage.getItem(LEGACY_CLOUD_OWNER_KEY);
        const canClaimLegacyData = !legacyOwner || legacyOwner === authenticatedUserId;
        if (!hasCloudData(cloudJournal) && hasCloudData(localJournal) && canClaimLegacyData) {
          await persistSupabaseJournalStore(localJournal, authenticatedUserId);
          window.localStorage.setItem(LEGACY_CLOUD_OWNER_KEY, authenticatedUserId);
          cloudJournal = { ...localJournal, sideQuests: [] };
        }
        if (!legacyOwner && hasCloudData(cloudJournal)) {
          window.localStorage.setItem(LEGACY_CLOUD_OWNER_KEY, authenticatedUserId);
        }

        if (cancelled) return;
        persistenceMode.current = "supabase";
        setJournal({
          ...cloudJournal,
          sideQuests: readLocalSideQuests(localJournal.sideQuests),
        });
      } catch (error) {
        if (cancelled) return;
        console.error("Supabase journal loading failed; using legacy local storage.", error);
        persistenceMode.current = "local";
        setJournal(localJournal);
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    }

    void loadJournal();
    return () => {
      cancelled = true;
    };
  }, [isAuthLoaded, userId]);

  const updateJournal = useCallback((update: JournalUpdate) => {
    setJournal((current) => {
      const next = typeof update === "function" ? update(current) : update;

      if (next.sideQuests !== current.sideQuests) {
        writeLocalSideQuests(next.sideQuests);
      }

      if (persistenceMode.current === "supabase") {
        const cloudDataChanged = next.entries !== current.entries
          || next.places !== current.places
          || next.categories !== current.categories
          || next.people !== current.people;

        if (cloudDataChanged) {
          writeQueue.current = writeQueue.current
            .then(() => {
              if (userId) return persistSupabaseJournalStore(next, userId);
            })
            .catch((error) => {
              console.error("Supabase journal persistence failed.", error);
            });
        }
      } else {
        // Retain the existing persistence path until Supabase loading is confirmed.
        writeJournalStore(next);
      }

      return next;
    });
  }, [userId]);

  return <JournalContext.Provider value={{ journal, isLoaded, updateJournal }}>{children}</JournalContext.Provider>;
}

export function useJournal() {
  const context = useContext(JournalContext);
  if (!context) throw new Error("useJournal must be used within JournalProvider");
  return context;
}
