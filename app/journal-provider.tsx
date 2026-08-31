"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  createEmptyJournalStore,
  readLocalSideQuests,
  writeLocalSideQuests,
  type JournalStore,
} from "@/lib/journal-storage";
import {
  isTransientJournalLoadError,
  loadSupabaseJournalStore,
  persistSupabaseJournalChanges,
} from "@/lib/journal-supabase";
import { useAuth } from "@/app/auth-provider";

type JournalUpdate = JournalStore | ((current: JournalStore) => JournalStore);
export type JournalMutation = {
  deletedEntryIds?: string[];
  deletedCategoryIds?: string[];
  deletedPersonIds?: string[];
  leftSharedEntryIds?: string[];
};

type JournalContextValue = {
  journal: JournalStore;
  isLoaded: boolean;
  updateJournal: (update: JournalUpdate, mutation?: JournalMutation) => void;
};

const JournalContext = createContext<JournalContextValue | null>(null);

export function JournalProvider({ children }: { children: ReactNode }) {
  const { user, session, isAuthLoaded } = useAuth();
  const userId = user?.id;
  const hasUser = Boolean(user);
  const hasSession = Boolean(session);
  const [journal, setJournal] = useState(createEmptyJournalStore);
  const [isLoaded, setIsLoaded] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const persistenceMode = useRef<"loading" | "supabase" | "error">("loading");
  const writeQueue = useRef(Promise.resolve());
  const initialLoadStarted = useRef(false);

  useEffect(() => {
    if (!isAuthLoaded || !hasSession || !userId) {
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
      setCloudError(null);

      const isInitialLoad = !initialLoadStarted.current;
      initialLoadStarted.current = true;
      if (isInitialLoad) {
        console.info("[initial-journal-load] Starting authenticated cloud load.", {
          isAuthLoaded,
          hasSession,
          hasUser,
          userId: authenticatedUserId,
        });
      }

      try {
        let cloudJournal;
        try {
          cloudJournal = await loadSupabaseJournalStore(authenticatedUserId, { diagnostic: isInitialLoad });
        } catch (firstError) {
          if (cancelled) return;
          if (isInitialLoad && isTransientJournalLoadError(firstError)) {
            console.warn("[initial-journal-load] First cloud load failed; retrying once.", firstError);
            await new Promise((resolve) => window.setTimeout(resolve, 350));
            if (cancelled) return;
            cloudJournal = await loadSupabaseJournalStore(authenticatedUserId, { diagnostic: true });
          } else {
            throw firstError;
          }
        }

        if (cancelled) return;
        persistenceMode.current = "supabase";
        setJournal({
          ...cloudJournal,
          sideQuests: readLocalSideQuests(),
        });
        setIsLoaded(true);
      } catch (error) {
        if (cancelled) return;
        console.error("Supabase journal loading failed.", error);
        persistenceMode.current = "error";
        setJournal(createEmptyJournalStore());
        setCloudError(error instanceof Error ? error.message : "An unknown Supabase error occurred.");
      }
    }

    void loadJournal();
    return () => {
      cancelled = true;
    };
  }, [hasSession, hasUser, isAuthLoaded, loadAttempt, userId]);

  const updateJournal = useCallback((update: JournalUpdate, mutation: JournalMutation = {}) => {
    setJournal((current) => {
      if (persistenceMode.current !== "supabase") {
        console.error("Journal mutation blocked because authenticated cloud data is not loaded.");
        return current;
      }

      const next = typeof update === "function" ? update(current) : update;

      if (next.sideQuests !== current.sideQuests) {
        writeLocalSideQuests(next.sideQuests);
      }

      const cloudDataChanged = next.entries !== current.entries
        || next.places !== current.places
        || next.categories !== current.categories
        || next.people !== current.people;

      if (cloudDataChanged) {
        writeQueue.current = writeQueue.current
          .then(() => {
            if (!userId) throw new Error("The authenticated user is unavailable.");
            return persistSupabaseJournalChanges(current, next, userId, mutation);
          })
          .catch((error) => {
            console.error("Supabase journal persistence failed.", error);
            persistenceMode.current = "error";
            setIsLoaded(false);
            setCloudError(error instanceof Error ? error.message : "An unknown Supabase sync error occurred.");
          });
      }

      return next;
    });
  }, [userId]);

  const content = !user ? children : cloudError ? (
    <main className="cloud-load-state" role="alert">
      <div>
        <span aria-hidden="true">!</span>
        <p className="eyebrow">CLOUD JOURNAL UNAVAILABLE</p>
        <h1>Your journal could not be loaded.</h1>
        <p>No local journal was opened and no changes were saved. Your existing browser data remains untouched.</p>
        <details><summary>Technical details</summary><code>{cloudError}</code></details>
        <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Retry</button>
      </div>
    </main>
  ) : !isLoaded ? (
    <div className="auth-loading">Opening your cloud journal…</div>
  ) : children;

  return <JournalContext.Provider value={{ journal, isLoaded, updateJournal }}>{content}</JournalContext.Provider>;
}

export function useJournal() {
  const context = useContext(JournalContext);
  if (!context) throw new Error("useJournal must be used within JournalProvider");
  return context;
}
