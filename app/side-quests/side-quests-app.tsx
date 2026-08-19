"use client";

import { useState } from "react";
import Link from "next/link";
import { useJournal } from "@/app/journal-provider";
import { generateSideQuest } from "@/lib/side-quests";
import { ResponsiveAppShell } from "@/app/responsive-app-shell";

const dateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });

export function SideQuestsApp() {
  const { journal, isLoaded, updateJournal } = useJournal();
  const [showCompleted, setShowCompleted] = useState(false);
  const activeQuests = journal.sideQuests.filter((quest) => quest.status === "active");
  const completedQuests = journal.sideQuests
    .filter((quest) => quest.status === "completed")
    .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt));
  const activeCount = journal.sideQuests.filter((quest) => quest.status === "active").length;

  function generateQuest() {
    updateJournal((current) => ({
      ...current,
      sideQuests: [generateSideQuest(current, current.sideQuests), ...current.sideQuests],
    }));
  }

  function toggleQuest(questId: string) {
    const now = new Date().toISOString();
    updateJournal((current) => ({
      ...current,
      sideQuests: current.sideQuests.map((quest) => quest.id === questId
        ? quest.status === "completed"
          ? { ...quest, status: "active", completedAt: undefined, updatedAt: now }
          : { ...quest, status: "completed", completedAt: now, updatedAt: now }
        : quest),
    }));
  }

  function renderQuest(quest: (typeof journal.sideQuests)[number]) {
    const linkedEntries = quest.linkedJournalEntryIds.map((id) => journal.entries.find((entry) => entry.id === id)).filter((entry) => Boolean(entry));
    const displayDate = quest.status === "completed" ? quest.completedAt ?? quest.updatedAt : quest.createdAt;
    return <article className={`side-quest-card ${quest.status}`} key={quest.id}><div className="quest-status-icon">{quest.status === "completed" ? "✓" : "◇"}</div><div className="quest-copy"><div className="quest-meta"><span>{quest.status === "completed" ? "COMPLETED" : "ACTIVE QUEST"}</span><time>{dateFormatter.format(new Date(displayDate))}</time></div><h2>{quest.title}</h2><p>{quest.description}</p>{linkedEntries.length > 0 && <div className="quest-links"><strong>Inspired by your journal</strong>{linkedEntries.map((entry) => { const place = entry && journal.places[entry.placeId]; return entry && place ? <span key={entry.id}>{place.name} · {dateFormatter.format(new Date(entry.visitedAt))}</span> : null; })}</div>}<button className="quest-toggle" onClick={() => toggleQuest(quest.id)}>{quest.status === "completed" ? "Move back to active" : "Mark complete"}</button></div></article>;
  }

  return <ResponsiveAppShell active="side-quests"><main className="collections-shell side-quests-shell">
    <aside className="sidebar">
      <header className="brand-row"><Link className="brand" href="/"><span className="brand-mark">E</span><span>Explore</span></Link><button className="avatar">AJ</button></header>
      <nav className="primary-nav" aria-label="Main navigation">
        <Link href="/"><span>◷</span> Journal <b>{journal.entries.length}</b></Link>
        <Link href="/map"><span>⌖</span> Map <b>{new Set(journal.entries.map((entry) => entry.placeId)).size}</b></Link>
        <Link href="/collections"><span>▦</span> Collections <b>{journal.categories.length}</b></Link>
        <Link className="active" href="/side-quests"><span>◇</span> Side Quests <b>{activeCount}</b></Link>
        <Link href="/?mode=log"><span>＋</span> Log a place</Link>
      </nav>
      <div className="sidebar-bottom"><div className="tiny-map"><span>◇</span></div><div><strong>Keep exploring</strong><small>{activeCount} active {activeCount === 1 ? "quest" : "quests"}</small></div></div>
    </aside>
    <section className="collections-panel side-quests-panel">
      <div className="mobile-header"><Link className="brand" href="/"><span className="brand-mark">E</span><span>Explore</span></Link><button className="avatar">AJ</button></div>
      <header className="side-quests-heading"><div><p className="eyebrow">SIDE QUESTS</p><h1>A reason to go somewhere new.</h1><p>Small experiences inspired by the places and memories already in your journal.</p></div><button onClick={generateQuest}>◇ Generate a quest</button></header>
      {!isLoaded ? <div className="collections-empty"><span>◇</span><h2>Loading quests…</h2></div> : journal.sideQuests.length === 0 ? <div className="side-quests-empty"><span>◇</span><h2>Your next story starts with a prompt.</h2><p>Generate a quest from a predefined idea. Explore will personalize it with your journal where possible.</p><button onClick={generateQuest}>Generate your first quest</button></div> : <>
        <section className="quest-section" aria-labelledby="active-quests-heading"><div className="quest-section-heading"><div><h2 id="active-quests-heading">Active quests</h2><span>{activeQuests.length}</span></div></div>{activeQuests.length > 0 ? <div className="side-quest-list">{activeQuests.map(renderQuest)}</div> : <div className="quest-section-empty"><p>No active quests. Generate a new one or restore one from Completed.</p></div>}</section>
        <section className="quest-section quest-archive" aria-labelledby="completed-quests-heading"><div className="quest-section-heading"><div><h2 id="completed-quests-heading">Completed</h2><span>{completedQuests.length}</span></div>{completedQuests.length > 0 && <button aria-expanded={showCompleted} onClick={() => setShowCompleted((current) => !current)}>{showCompleted ? "Hide completed" : "View completed"}</button>}</div>{showCompleted && <div className="side-quest-list">{completedQuests.map(renderQuest)}</div>}</section>
      </>}
    </section>
    <nav className="mobile-nav"><Link href="/"><span>◷</span>Journal</Link><Link href="/map"><span>⌖</span>Map</Link><Link href="/collections"><span>▦</span>Collections</Link><Link className="active" href="/side-quests"><span>◇</span>Quests</Link></nav>
  </main></ResponsiveAppShell>;
}
