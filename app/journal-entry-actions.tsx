"use client";

import { useJournal } from "./journal-provider";

export function JournalEntryActions({ entryId, placeName, onEdit, onDeleted }: { entryId: string; placeName: string; onEdit: () => void; onDeleted?: () => void }) {
  const { updateJournal } = useJournal();

  function deleteEntry() {
    console.info("[mobile-delete-debug] Journal entry delete handler fired", { entryId, placeName });
    const confirmed = window.confirm(`Delete this visit to “${placeName}”? This cannot be undone.`);
    console.info("[mobile-delete-debug] Journal entry confirmation result", { entryId, confirmed });
    if (!confirmed) return;
    updateJournal((current) => ({
      ...current,
      entries: current.entries.filter((entry) => entry.id !== entryId),
    }), { deletedEntryIds: [entryId] });
    console.info("[mobile-delete-debug] Journal entry delete update dispatched", { entryId });
    onDeleted?.();
  }

  return <div className="journal-entry-actions">
    <button type="button" onClick={onEdit}>Edit</button>
    <button type="button" className="danger" onClick={deleteEntry}>Delete</button>
  </div>;
}
