"use client";

import { useState } from "react";
import { useAuth } from "@/app/auth-provider";
import { useJournal } from "@/app/journal-provider";
import { createJournalBackup } from "@/lib/journal-backup";

export function ProfileSheet({ onClose, placeCount, visitCount, collectionCount, titleId = "profile-sheet-title" }: { onClose: () => void; placeCount: number; visitCount: number; collectionCount: number; titleId?: string }) {
  const { user, initials, signOut } = useAuth();
  const { journal, isLoaded } = useJournal();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isSigningOut, setIsSigningOut] = useState(false);
  async function logout() {
    setError(""); setMessage(""); setIsSigningOut(true);
    try { await signOut(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not log out."); setIsSigningOut(false); }
  }

  function exportBackup() {
    setError(""); setMessage("");
    const blob = new Blob([JSON.stringify(createJournalBackup(journal), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `explore-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Backup exported.");
  }

  return <div className="profile-sheet-backdrop" role="presentation" onClick={onClose}><section className="profile-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}><button className="profile-sheet-close" onClick={onClose} aria-label="Close profile and settings">×</button><div className="profile-avatar">{initials}</div><p className="eyebrow">PROFILE & SETTINGS</p><h2 id={titleId}>Your private journal.</h2><p className="profile-email">Signed in as <strong>{user?.email}</strong>. Your cloud journal data is kept separate from other Explore accounts.</p><dl><div><dt>Places</dt><dd>{placeCount}</dd></div><div><dt>Visits</dt><dd>{visitCount}</dd></div><div><dt>Collections</dt><dd>{collectionCount}</dd></div></dl><section className="backup-settings" aria-labelledby={`${titleId}-backup`}><div><strong id={`${titleId}-backup`}>Backup & recovery</strong><span>Export your complete Explore journal. Cloud restore is temporarily disabled to protect newer data.</span></div><div><button type="button" onClick={exportBackup} disabled={!isLoaded}>Export JSON</button><button type="button" disabled title="Cloud restore is temporarily disabled">Import unavailable</button></div></section>{error && <p className="profile-error" role="alert">{error}</p>}{message && <p className="profile-message" role="status">{message}</p>}<div className="profile-actions"><button className="profile-logout" onClick={logout} disabled={isSigningOut}>{isSigningOut ? "Logging out…" : "Log out"}</button><button className="profile-sheet-done" onClick={onClose}>Done</button></div></section></div>;
}
