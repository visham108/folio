import { Camera, Link2, X } from 'lucide-react'
import { nameCase, titleCase } from '../lib/titleCase'
import { useRef, useState } from 'react'
import { FORMATS, type Edition, type Format } from '../lib/types'
import { cleanIsbn, fmtDuration, nowIso, parseDuration, uid } from '../lib/util'
import { Cover } from './Cover'
import { CoverStudio } from './CoverStudio'
import { Chips, ConfirmSheet, Field, Segmented } from './ui'

export type EditionDraft = Omit<Edition, 'id' | 'workId' | 'createdAt'> & { id?: string }

export const blankEdition = (format: Format = 'paperback'): EditionDraft => ({ format, narrators: [], translators: [] })

/** The edition-level fields. Shared by the add flow and the "add/edit edition" sheet. */
export function EditionFields({ value, onChange, title, authors }: {
  value: EditionDraft
  onChange: (e: EditionDraft) => void
  title: string
  authors: string[]
}) {
  const set = (p: Partial<EditionDraft>) => onChange({ ...value, ...p })
  const audio = value.format === 'audiobook'
  const [dur, setDur] = useState(value.durationMin ? fmtDuration(value.durationMin) : '')
  const [more, setMore] = useState(false)
  return (
    <div className="edition-fields">
      <CoverPicker value={value} title={title} authors={authors} onChange={(coverUrl) => set({ coverUrl })} />
      <div className="form-grid">
        <Field label="Format" required className="span-2">
          <Segmented<Format> label="Format" value={value.format} onChange={(format) => set({ format })} options={FORMATS.map((f) => ({ id: f.id, label: f.label }))} />
        </Field>
        {audio ? (
          <>
            <Field label="Length" hint={!value.durationMin ? 'e.g. 11h 23m. Needed for listening stats' : undefined}>
              <input className="input" value={dur} placeholder="11h 23m" onChange={(e) => { setDur(e.target.value); set({ durationMin: parseDuration(e.target.value) }) }} />
            </Field>
            <Field label="Narrated by"><Chips value={value.narrators} onChange={(narrators) => set({ narrators })} placeholder="Narrator" normalize={nameCase} /></Field>
          </>
        ) : (
          <Field label="Pages" hint={!value.pages ? 'Needed for page stats' : undefined}>
            <input className="input" inputMode="numeric" value={value.pages ?? ''} placeholder="320" onChange={(e) => set({ pages: parseInt(e.target.value, 10) || undefined })} />
          </Field>
        )}
        <Field label={audio ? 'Publisher' : 'Publisher'}>
          <input className="input" value={value.publisher ?? ''} placeholder={audio ? 'Audible Studios' : 'Penguin'} onChange={(e) => set({ publisher: e.target.value || undefined })} onBlur={(e) => set({ publisher: titleCase(e.target.value) || undefined })} />
        </Field>
        {!more && <button type="button" className="link span-2 more-toggle" onClick={() => setMore(true)}>+ ISBN, date, language, translator…</button>}
        {more && (
          <>
            <Field label="Published"><input className="input" value={value.publishedDate ?? ''} placeholder="2019 or 2019-06-04" onChange={(e) => set({ publishedDate: e.target.value || undefined })} /></Field>
            <Field label="Language"><input className="input" value={value.language ?? ''} placeholder="en" onChange={(e) => set({ language: e.target.value || undefined })} /></Field>
            <Field label="ISBN" hint={value.isbn13 || value.isbn10 ? undefined : '10 or 13 digits'}>
              <input className="input" inputMode="numeric" defaultValue={value.isbn13 ?? value.isbn10 ?? ''} onChange={(e) => {
                const c = cleanIsbn(e.target.value)
                set(c?.length === 13 ? { isbn13: c, isbn10: undefined } : c?.length === 10 ? { isbn10: c, isbn13: undefined } : { isbn10: undefined, isbn13: undefined })
              }} />
            </Field>
            {(audio || value.format === 'ebook') && (
              <Field label="ASIN"><input className="input" value={value.asin ?? ''} onChange={(e) => set({ asin: e.target.value.trim().toUpperCase() || undefined })} /></Field>
            )}
            <Field label="Edition title" hint="Only if different, e.g. a translation or UK title"><input className="input" value={value.title ?? ''} onChange={(e) => set({ title: e.target.value || undefined })} onBlur={(e) => set({ title: titleCase(e.target.value) || undefined })} /></Field>
            <Field label="Translated by"><Chips value={value.translators} onChange={(translators) => set({ translators })} normalize={nameCase} /></Field>
            <Field label="Edition note" className="span-2"><input className="input" value={value.note ?? ''} placeholder="Illustrated, 50th anniversary, signed…" onChange={(e) => set({ note: e.target.value || undefined })} /></Field>
          </>
        )}
      </div>
    </div>
  )
}

function CoverPicker({ value, title, authors, onChange }: {
  value: EditionDraft; title: string; authors: string[]; onChange: (url?: string) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [urlMode, setUrlMode] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="cover-picker">
      <Cover work={{ title: title || 'Untitled', authors: authors.length ? authors : [''] }} edition={value} size="lg" />
      <div className="cover-picker-actions">
        <button type="button" className="btn btn-soft sm" onClick={() => input.current?.click()}><Camera size={14} /> Photo</button>
        <button type="button" className="btn btn-ghost sm" onClick={() => setUrlMode((x) => !x)}><Link2 size={14} /> URL</button>
        {value.coverUrl && <button type="button" className="icon-btn" aria-label="Remove cover" onClick={() => onChange(undefined)}><X size={14} /></button>}
      </div>
      {urlMode && (
        <input className="input sm" placeholder="https://…" defaultValue={value.coverUrl?.startsWith('http') ? value.coverUrl : ''} onBlur={(e) => e.target.value && onChange(e.target.value.trim())} autoFocus />
      )}
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = '' }} />
      <CoverStudio
        file={file}
        onClose={() => setFile(null)}
        onDone={(url) => { onChange(url); setFile(null) }}
      />
    </div>
  )
}

/** Stand-alone form used from the book page. */
export function EditionForm({ workId, workTitle, initial, onDone, onDelete }: {
  workId: string; workTitle: string; initial?: Edition; onDone: (e: Edition) => void; onDelete?: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [d, setD] = useState<EditionDraft>(initial ?? blankEdition())
  return (
    <div>
      <EditionFields value={d} onChange={setD} title={d.title || workTitle} authors={[]} />
      <div className="sheet-inline-foot">
        {onDelete && <button className="btn btn-ghost danger" onClick={() => setConfirmDelete(true)}>Remove edition</button>}
        <button className="btn btn-primary" onClick={() => onDone({ ...d, id: initial?.id ?? uid(), workId, createdAt: initial?.createdAt ?? nowIso() } as Edition)}>
          {initial ? 'Save edition' : 'Add edition'}
        </button>
      </div>
      {onDelete && (
        <ConfirmSheet open={confirmDelete} title="Remove this edition?" confirmLabel="Remove edition" danger onClose={() => setConfirmDelete(false)} onConfirm={onDelete}>
          <p>It disappears from the catalogue for everyone. Readers who had it as their edition keep the book and their history.</p>
        </ConfirmSheet>
      )}
    </div>
  )
}
