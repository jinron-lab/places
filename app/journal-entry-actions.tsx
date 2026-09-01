"use client";

import { useJournal } from "./journal-provider";

export function JournalEntryActions({ entryId, placeName, onEdit, onDeleted }: { entryId: string; placeName: string; onEdit: () => void; onDeleted?: () => void }) {
  const { journal, updateJournal } = useJournal();
  const entry = journal.entries.find((item) => item.id === entryId);
  const isShared = entry?.access === "shared";

  function deleteEntry() {
    const confirmed = window.confirm(`Delete this visit to “${placeName}”? This cannot be undone.`);
    if (!confirmed) return;
    updateJournal((current) => ({
      ...current,
      entries: current.entries.filter((entry) => entry.id !== entryId),
    }), { deletedEntryIds: [entryId] });
    onDeleted?.();
  }

  function leaveEntry() {
    if (!window.confirm(`Remove the shared visit to “${placeName}” from your journal?`)) return;
    updateJournal((current) => ({
      ...current,
      entries: current.entries.filter((item) => item.id !== entryId),
    }), { leftSharedEntryIds: [entryId] });
    onDeleted?.();
  }

  if (isShared) return <div className="journal-entry-actions shared-entry-actions"><span>Shared by {entry.ownerDisplayName ?? `@${entry.ownerUsername ?? "Explore user"}`} · read only</span><button type="button" className="danger" onClick={leaveEntry}>Remove from my journal</button></div>;

  return <div className="journal-entry-actions">
    <button type="button" onClick={onEdit}>Edit</button>
    <button type="button" className="danger" onClick={deleteEntry}>Delete</button>
  </div>;
}
