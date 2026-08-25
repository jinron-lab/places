"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useJournal } from "@/app/journal-provider";
import { useAuth } from "@/app/auth-provider";

export type AppSection = "home" | "collections" | "people" | "map" | "side-quests" | "log" | "profile";

export function ResponsiveAppShell({ active, children }: { active: AppSection; children: ReactNode }) {
  const { journal } = useJournal();
  const { initials } = useAuth();
  const placeCount = new Set(journal.entries.map((entry) => entry.placeId)).size;
  const activeQuestCount = journal.sideQuests.filter((quest) => quest.status === "active").length;
  return <div className={`shared-app-shell section-${active}`}><aside className="sidebar shared-sidebar"><header className="brand-row"><Link className="brand" href="/"><span className="brand-mark">E</span><span>Explore</span></Link><Link className="avatar" href="/profile" aria-label="Open profile">{initials}</Link></header><nav className="primary-nav" aria-label="Main navigation"><Link className={active === "home" ? "active" : ""} href="/"><span>⌂</span> Home <b>{journal.entries.length}</b></Link><Link className={active === "collections" ? "active" : ""} href="/collections"><span>▦</span> Collections <b>{journal.categories.length}</b></Link><Link className={active === "people" ? "active" : ""} href="/people"><span>♙</span> People <b>{journal.people.length}</b></Link><Link className={active === "map" ? "active" : ""} href="/map"><span>⌖</span> Map <b>{placeCount}</b></Link><Link className={active === "side-quests" ? "active" : ""} href="/side-quests"><span>◇</span> Side Quests <b>{activeQuestCount}</b></Link><Link className={active === "log" ? "active" : ""} href="/?mode=log"><span>＋</span> Log a place</Link><Link className={active === "profile" ? "active" : ""} href="/profile"><span>○</span> Profile & Friends</Link></nav><div className="sidebar-bottom"><div className="tiny-map"><span>•</span><i /></div><div><strong>My place journal</strong><small>{placeCount} places remembered</small></div></div></aside><div className="shared-app-content">{children}</div><nav className="shared-bottom-nav" aria-label="Primary mobile navigation"><Link className={active === "home" || active === "log" ? "active" : ""} href="/"><span>⌂</span>Home</Link><Link className={active === "collections" ? "active" : ""} href="/collections"><span>▦</span>Collections</Link><Link className={active === "people" ? "active" : ""} href="/people"><span>♙</span>People</Link><Link className={active === "map" ? "active" : ""} href="/map"><span>⌖</span>Map</Link><Link className={active === "profile" ? "active" : ""} href="/profile"><span>○</span>Profile</Link></nav></div>;
}
