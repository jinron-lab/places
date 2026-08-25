"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { getDefaultCategoryColor } from "@/lib/category-appearance";
import { createUuid } from "@/lib/id";
import { QUICK_LOG_TAGS, type JournalEntry, type PersonalRating } from "@/lib/journal";
import { useJournal } from "./journal-provider";

export type JournalEntryFormValues = Pick<JournalEntry, "visitedAt" | "rating" | "notes" | "categoryIds" | "personIds">;

type EntityOption = { id: string; name: string; linkedUserId?: string; linkedUsername?: string };

function EntityPicker({ label, placeholder, options, selectedIds, input, setInput, toggle, create }: { label: string; placeholder: string; options: EntityOption[]; selectedIds: string[]; input: string; setInput: (value: string) => void; toggle: (id: string) => void; create: (name: string) => void }) {
  const [isCreating, setIsCreating] = useState(false);
  const selected = options.filter((option) => selectedIds.includes(option.id));

  function createItem() {
    if (!input.trim()) return;
    create(input);
    setIsCreating(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      createItem();
    }
    if (event.key === "Escape") {
      setInput("");
      setIsCreating(false);
    }
  }

  return <fieldset className="metadata-field"><legend>{label}</legend><details className="entity-select"><summary><span>{selected.length > 0 ? selected.map((option) => option.name).join(", ") : `Select ${label.toLocaleLowerCase()}`}</span><b>{selected.length || "⌄"}</b></summary><div className="entity-menu"><div className="entity-option-list">{options.length > 0 ? options.map((option) => <button type="button" key={option.id} className={selectedIds.includes(option.id) ? "active" : ""} onClick={() => toggle(option.id)}><span>{selectedIds.includes(option.id) ? "✓" : ""}</span>{option.name}{option.linkedUserId && <small>Shares with @{option.linkedUsername ?? "friend"}</small>}</button>) : <p>No {label.toLocaleLowerCase()} yet.</p>}</div>{isCreating ? <div className="entity-create"><input autoFocus value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleKeyDown} placeholder={placeholder} /><div><button type="button" className="cancel" onClick={() => { setInput(""); setIsCreating(false); }}>Cancel</button><button type="button" onClick={createItem} disabled={!input.trim()}>Create</button></div></div> : <button type="button" className="entity-create-trigger" onClick={() => setIsCreating(true)}>+ Create new {label === "People" ? "person" : "category"}</button>}</div></details>{selected.some((option) => option.linkedUserId) && <p className="entry-share-notice">Linked friends selected here will receive read-only access to this entry.</p>}{selected.length > 0 && <div className="metadata-chips">{selected.map((option) => <button type="button" key={option.id} onClick={() => toggle(option.id)}>{option.name}{option.linkedUserId ? " · shared" : ""}<span>×</span></button>)}</div>}</fieldset>;
}

export function JournalEntryForm({ entry, submitLabel, onSubmit, onCancel }: { entry?: JournalEntry; submitLabel: string; onSubmit: (values: JournalEntryFormValues) => void; onCancel: () => void }) {
  const { journal, updateJournal } = useJournal();
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const [visitDate, setVisitDate] = useState(() => entry?.visitedAt.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  const [personalRating, setPersonalRating] = useState<PersonalRating | null>(entry?.rating ?? null);
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [categoryIds, setCategoryIds] = useState<string[]>(() => [...(entry?.categoryIds ?? [])]);
  const [personIds, setPersonIds] = useState<string[]>(() => [...(entry?.personIds ?? [])]);
  const [categoryInput, setCategoryInput] = useState("");
  const [personInput, setPersonInput] = useState("");

  function toggleId(id: string, values: string[], setValues: (next: string[]) => void) {
    setValues(values.includes(id) ? values.filter((value) => value !== id) : [...values, id]);
  }

  function createCategory(value: string) {
    const name = value.trim().replace(/^#+/, "");
    if (!name) return;
    const existing = journal.categories.find((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    const id = `category:${createUuid()}`;
    const category = existing ?? { id, name, color: getDefaultCategoryColor(id), createdAt: new Date().toISOString() };
    if (!existing) updateJournal((current) => ({ ...current, categories: [...current.categories, category] }));
    setCategoryIds((current) => current.includes(category.id) ? current : [...current, category.id]);
    setCategoryInput("");
  }

  function createPerson(value: string) {
    const name = value.trim().replace(/^@+/, "");
    if (!name) return;
    const existing = journal.people.find((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    const person = existing ?? { id: `person:${createUuid()}`, name, createdAt: new Date().toISOString() };
    if (!existing) updateJournal((current) => ({ ...current, people: [...current.people, person] }));
    setPersonIds((current) => current.includes(person.id) ? current : [...current, person.id]);
    setPersonInput("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!personalRating || !visitDate) return;
    onSubmit({
      visitedAt: new Date(`${visitDate}T12:00:00`).toISOString(),
      rating: personalRating,
      notes: notes.trim() || undefined,
      categoryIds: [...categoryIds],
      personIds: [...personIds],
    });
  }

  return <form className="journal-form" onSubmit={handleSubmit}>
    <label><span>Visit date</span><input type="date" value={visitDate} onChange={(event) => setVisitDate(event.target.value)} required /></label>
    <fieldset><legend>Personal rating</legend><div className="rating-picker" role="radiogroup" aria-label="Personal rating">{([1, 2, 3, 4, 5] as const).map((star) => <span className="rating-star" key={star}><span className="rating-star-empty">★</span><span className="rating-star-fill" style={{ width: `${Math.max(0, Math.min(1, (personalRating ?? 0) - (star - 1))) * 100}%` }}>★</span><button type="button" className="rating-half left" role="radio" aria-checked={personalRating === star - 0.5} aria-label={`${star - 0.5} out of 5 stars`} onClick={() => setPersonalRating((star - 0.5) as PersonalRating)} /><button type="button" className="rating-half right" role="radio" aria-checked={personalRating === star} aria-label={`${star} out of 5 stars`} onClick={() => setPersonalRating(star as PersonalRating)} /></span>)}</div>{personalRating && <span className="rating-value">{personalRating} / 5</span>}</fieldset>
    <EntityPicker label="Categories" placeholder="Create a category…" options={journal.categories} selectedIds={categoryIds} input={categoryInput} setInput={setCategoryInput} toggle={(id) => toggleId(id, categoryIds, setCategoryIds)} create={createCategory} />
    <EntityPicker label="People" placeholder="Add a person…" options={journal.people} selectedIds={personIds} input={personInput} setInput={setPersonInput} toggle={(id) => toggleId(id, personIds, setPersonIds)} create={createPerson} />
    <fieldset className="quick-tags-field"><legend>Quick log</legend><p>Add a line to your notes</p><div className="quick-tag-picker">{QUICK_LOG_TAGS.map((text) => <button type="button" key={text} onClick={() => { setNotes((current) => `${current}${current && !current.endsWith("\n") ? "\n" : ""}${text}`); notesRef.current?.focus(); }}>+ {text}</button>)}</div></fieldset>
    <label><span>Notes</span><textarea ref={notesRef} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What do you want to remember?" rows={3} /></label>
    <div className="form-actions"><button type="button" onClick={onCancel}>Cancel</button><button type="submit" disabled={!personalRating}>{submitLabel}</button></div>
  </form>;
}
