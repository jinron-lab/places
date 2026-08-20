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

type JournalUpdate = JournalStore | ((current: JournalStore) => JournalStore);

type JournalContextValue = {
  journal: JournalStore;
  isLoaded: boolean;
  updateJournal: (update: JournalUpdate) => void;
};

const JournalContext = createContext<JournalContextValue | null>(null);

export function JournalProvider({ children }: { children: ReactNode }) {
  const [journal, setJournal] = useState(createEmptyJournalStore);
  const [isLoaded, setIsLoaded] = useState(false);
  const persistenceMode = useRef<"loading" | "supabase" | "local">("loading");
  const writeQueue = useRef(Promise.resolve());

  useEffect(() => {
    let cancelled = false;

    async function loadJournal() {
      // Keep the legacy read and migration until a Supabase load has succeeded.
      const localJournal = readJournalStore();

      try {
        let cloudJournal = await loadSupabaseJournalStore();
        if (!hasCloudData(cloudJournal) && hasCloudData(localJournal)) {
          await persistSupabaseJournalStore(localJournal);
          cloudJournal = { ...localJournal, sideQuests: [] };
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
  }, []);

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
            .then(() => persistSupabaseJournalStore(next))
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
  }, []);

  return <JournalContext.Provider value={{ journal, isLoaded, updateJournal }}>{children}</JournalContext.Provider>;
}

export function useJournal() {
  const context = useContext(JournalContext);
  if (!context) throw new Error("useJournal must be used within JournalProvider");
  return context;
}
