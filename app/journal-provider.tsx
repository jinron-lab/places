"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  createEmptyJournalStore,
  readJournalStore,
  writeJournalStore,
  type JournalStore,
} from "@/lib/journal-storage";

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

  useEffect(() => {
    // Loading after mount keeps the server and first client render identical.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJournal(readJournalStore());
    setIsLoaded(true);
  }, []);

  const updateJournal = useCallback((update: JournalUpdate) => {
    setJournal((current) => {
      const next = typeof update === "function" ? update(current) : update;
      writeJournalStore(next);
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
