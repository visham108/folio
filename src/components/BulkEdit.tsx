import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { titleCase } from '../lib/titleCase'
import { FORMATS, STATUSES, type Format, type Status } from '../lib/types'
import { plural } from '../lib/util'
import { useStore } from '../state/store'
import { useToast } from '../state/toast'
import { Chips, ConfirmSheet, Segmented, Sheet } from './ui'

type Keep = 'keep'
type YesNo = 'yes' | 'no'

/** Change the same fields on many books at once. Anything left on "Leave as is" isn't touched. */
export function BulkEditSheet({ ids, open, onClose, onDone }: { ids: string[]; open: boolean; onClose: () => void; onDone: () => void }) {
  const store = useStore()
  const toast = useToast()
  const [format, setFormat] = useState<Format | Keep>('keep')
  const [status, setStatus] = useState<Status | Keep>('keep')
  const [addShelf, setAddShelf] = useState('')
  const [removeShelf, setRemoveShelf] = useState('')
  const [addTags, setAddTags] = useState<string[]>([])
  const [removeTag, setRemoveTag] = useState('')
  const [owned, setOwned] = useState<YesNo | Keep>('keep')
  const [favorite, setFavorite] = useState<YesNo | Keep>('keep')
  const [confirmRemove, setConfirmRemove] = useState(false)
  useEffect(() => {
    if (!open) return
    setFormat('keep'); setStatus('keep'); setAddShelf(''); setRemoveShelf(''); setAddTags([]); setRemoveTag(''); setOwned('keep'); setFavorite('keep')
  }, [open])

  const entries = ids.map((id) => store.entries.get(id)).filter((e): e is NonNullable<typeof e> => !!e)
  const tagsInUse = [...new Set(entries.flatMap((e) => e.tags))].sort()
  const shelves = [...store.data.shelves].sort((a, b) => a.position - b.position)
  const changes = format !== 'keep' || status !== 'keep' || !!addShelf || !!removeShelf || addTags.length > 0 || !!removeTag || owned !== 'keep' || favorite !== 'keep'

  const apply = () => {
    for (const e of entries) {
      if (format !== 'keep') store.setFormat(e.id, format)
      if (status !== 'keep' && e.status !== status) store.setStatus(e.id, status, { undated: true })
      const patch: Parameters<typeof store.updateEntry>[1] = {}
      let shelfIds = e.shelfIds
      if (addShelf && !shelfIds.includes(addShelf)) shelfIds = [...shelfIds, addShelf]
      if (removeShelf) shelfIds = shelfIds.filter((x) => x !== removeShelf)
      if (shelfIds !== e.shelfIds) patch.shelfIds = shelfIds
      let tags = e.tags
      for (const t of addTags) if (!tags.includes(t)) tags = [...tags, t]
      if (removeTag) tags = tags.filter((x) => x !== removeTag)
      if (tags !== e.tags) patch.tags = tags
      if (owned !== 'keep' && e.owned !== (owned === 'yes')) patch.owned = owned === 'yes'
      if (favorite !== 'keep' && e.favorite !== (favorite === 'yes')) patch.favorite = favorite === 'yes'
      if (Object.keys(patch).length) store.updateEntry(e.id, patch)
    }
    toast(`Updated ${plural(entries.length, 'book')}`)
    onDone()
  }

  const remove = () => {
    const undos = entries.map((e) => store.removeEntry(e.id))
    setConfirmRemove(false)
    toast(`Removed ${plural(undos.length, 'book')}`, { action: { label: 'Undo', run: () => undos.forEach((u) => u()) } })
    onDone()
  }

  const keepOpt = { id: 'keep' as const, label: 'Leave as is' }
  return (
    <>
      <Sheet open={open} onClose={onClose} title={`Edit ${plural(entries.length, 'book')}`} wide footer={
        <>
          <button className="btn btn-ghost danger" onClick={() => setConfirmRemove(true)}><Trash2 size={14} /> Remove from library</button>
          <button className="btn btn-primary" disabled={!changes} onClick={apply}>Apply to {plural(entries.length, 'book')}</button>
        </>
      }>
        <p className="muted small">Only what you change is applied; everything left as is stays as it was on each book.</p>
        <div className="bulk-grid">
          <div className="field">
            <span className="field-label" id="bulk-format">Format</span>
            <Segmented<Format | Keep> label="Format" value={format} onChange={setFormat}
              options={[keepOpt, ...FORMATS.map((f) => ({ id: f.id, label: f.label }))]} />
          </div>
          <div className="field">
            <span className="field-label">Pile</span>
            <Segmented<Status | Keep> label="Pile" value={status} onChange={setStatus}
              options={[keepOpt, ...STATUSES.map((s) => ({ id: s.id, label: s.short }))]} />
            {status === 'read' && <span className="field-hint">Books that weren’t read yet are marked read without a date, so they don’t all land on today.</span>}
          </div>
          {shelves.length > 0 && (
            <div className="bulk-pair">
              <label className="field">
                <span className="field-label">Add to shelf</span>
                <select className="select" value={addShelf} onChange={(e) => setAddShelf(e.target.value)}>
                  <option value="">Leave as is</option>
                  {shelves.map((s) => <option key={s.id} value={s.id}>{s.emoji ? `${s.emoji} ` : ''}{s.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Take off shelf</span>
                <select className="select" value={removeShelf} onChange={(e) => setRemoveShelf(e.target.value)}>
                  <option value="">Leave as is</option>
                  {shelves.map((s) => <option key={s.id} value={s.id}>{s.emoji ? `${s.emoji} ` : ''}{s.name}</option>)}
                </select>
              </label>
            </div>
          )}
          <div className="bulk-pair">
            <div className="field">
              <span className="field-label">Add tags</span>
              <Chips value={addTags} onChange={setAddTags} normalize={titleCase} placeholder="Type a tag, then Enter" />
            </div>
            {tagsInUse.length > 0 && (
              <label className="field">
                <span className="field-label">Remove tag</span>
                <select className="select" value={removeTag} onChange={(e) => setRemoveTag(e.target.value)}>
                  <option value="">Leave as is</option>
                  {tagsInUse.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="bulk-pair">
            <div className="field">
              <span className="field-label">I own a copy</span>
              <Segmented<YesNo | Keep> size="sm" label="I own a copy" value={owned} onChange={setOwned}
                options={[keepOpt, { id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }]} />
            </div>
            <div className="field">
              <span className="field-label">Favourite</span>
              <Segmented<YesNo | Keep> size="sm" label="Favourite" value={favorite} onChange={setFavorite}
                options={[keepOpt, { id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }]} />
            </div>
          </div>
        </div>
      </Sheet>
      <ConfirmSheet open={confirmRemove} title={`Remove ${plural(entries.length, 'book')}?`} confirmLabel="Remove" danger
        onClose={() => setConfirmRemove(false)} onConfirm={remove}>
        <p>They and their reading history leave your shelves. The books stay in the shared catalogue, and you can undo straight after.</p>
      </ConfirmSheet>
    </>
  )
}
