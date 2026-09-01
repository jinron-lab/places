"use client";

import Link from "next/link";
import { useJournal } from "@/app/journal-provider";
import { generateSideQuest } from "@/lib/side-quests";
import { ResponsiveAppShell } from "@/app/responsive-app-shell";
import { useAuth } from "@/app/auth-provider";

export function HomeDashboard() {
  const { journal, updateJournal } = useJournal();
  const { initials } = useAuth();
  const placeCount = new Set(journal.entries.filter((entry) => entry.access !== "shared").map((entry) => entry.placeId)).size;
  const activeQuest = journal.sideQuests.filter((quest) => quest.status === "active").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  function generateQuest() {
    updateJournal((current) => ({
      ...current,
      sideQuests: [generateSideQuest(current, current.sideQuests), ...current.sideQuests],
    }));
  }

  return <ResponsiveAppShell active="home"><main className="home-dashboard-shell">
    <aside className="sidebar home-sidebar">
      <header className="brand-row"><Link className="brand" href="/"><span className="brand-mark">E</span><span>Explore</span></Link><Link className="avatar" href="/profile">{initials}</Link></header>
      <nav className="primary-nav" aria-label="Main navigation">
        <Link className="active" href="/"><span>⌂</span> Home</Link>
        <Link href="/collections"><span>▦</span> Collections <b>{journal.categories.length}</b></Link>
        <Link href="/map"><span>⌖</span> Map <b>{placeCount}</b></Link>
        <Link href="/side-quests"><span>◇</span> Side Quests <b>{journal.sideQuests.filter((quest) => quest.status === "active").length}</b></Link>
        <Link href="/profile"><span>○</span> Profile & Friends</Link>
      </nav>
      <div className="sidebar-bottom"><div className="tiny-map"><span>•</span><i /></div><div><strong>My place journal</strong><small>{placeCount} places remembered</small></div></div>
    </aside>

    <section className="home-dashboard">
      <header className="home-mobile-header"><Link className="brand" href="/"><span className="brand-mark">E</span><span>Explore</span></Link><Link className="avatar" href="/profile">{initials}</Link></header>
      <section className="home-intro"><p className="eyebrow">MY PLACE JOURNAL</p><h1>Home</h1></section>

      <section className="home-actions" aria-label="Quick actions">
        <Link className="home-action primary" href="/?mode=log"><span>＋</span><div><strong>Log a place</strong><small>Add a visit and memory</small></div><b>›</b></Link>
        <button className="home-action" onClick={generateQuest}><span>◇</span><div><strong>Generate side quest</strong><small>Find a reason to wander</small></div><b>›</b></button>
      </section>

      <section className="home-current-quest"><div className="home-section-title"><div><p className="eyebrow">YOUR NEXT ADVENTURE</p><h2>Current Quest</h2></div>{activeQuest && <Link href="/side-quests">Open quests →</Link>}</div>{activeQuest ? <article className="home-quest"><h3>{activeQuest.title}</h3><p>{activeQuest.description}</p></article> : <div className="home-quest-empty"><p>No active quest yet.</p><button onClick={generateQuest}>Generate a side quest</button></div>}</section>

    </section>

    <nav className="home-bottom-nav" aria-label="Primary mobile navigation"><Link className="active" href="/"><span>⌂</span>Home</Link><Link href="/collections"><span>▦</span>Collections</Link><Link href="/map"><span>⌖</span>Map</Link><Link href="/profile"><span>○</span>Profile</Link></nav>
  </main></ResponsiveAppShell>;
}
