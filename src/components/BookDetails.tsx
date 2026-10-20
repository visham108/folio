import { Loader2, Lock, Search } from 'lucide-react'
import { needsLength } from '../lib/fillLengths'
import type { Edition, Entry, Work } from '../lib/types'
import { useStore } from '../state/store'
import { useFillLengths } from './FillLengths'
import { rowOf, useCellEditor, useColumns, type Group, type Row } from './LibraryTable'

// Short table headings spelled out where there's room.
const LABELS: Record<string, string> = { seriesIndex: 'Number in series', durationMin: 'Length (audio)' }

const GROUPS: { id: Group; label: string }[] = [
  { id: 'Book', label: 'Book' },
  { id: 'Edition', label: 'Your edition' },
  { id: 'Your copy', label: 'Your copy' },
  { id: 'Reading', label: 'Latest read' },
]

/**
 * Every attribute of one book, the same fields as the Library table, each one click to change.
 * A book that isn't on your shelves shows just its catalogue details.
 */
export function BookDetails({ work, entry, edition }: { work: Work; entry?: Entry; edition?: Edition }) {
  const store = useStore()
  const columns = useColumns()
  const cell = useCellEditor()
  const fill = useFillLengths()
  const row: Row = entry
    ? rowOf(store, entry)
    : {
      entry: { id: '', workId: work.id, status: 'want', favorite: false, owned: false, tags: [], shelfIds: [], addedAt: '', updatedAt: '' },
      work, edition, reads: [], finished: 0,
    }
  const groups = entry ? GROUPS : GROUPS.slice(0, 2)
  const ed = row.edition

  return (
    <div className="details">
      {groups.map((g) => (
        <section key={g.id} className={`details-group dg-${g.id.replace(' ', '-').toLowerCase()}`} aria-labelledby={`dg-${g.id.replace(' ', '-')}`}>
          <h3 id={`dg-${g.id.replace(' ', '-')}`}>{g.label}</h3>
          <dl>
            {columns.filter((c) => c.group === g.id).map((c) => {
              const text = c.text(row)
              const editing = cell.isEditing(c, row)
              const canChange = !!entry && cell.editable(c, row)
              const lock = cell.locked(c, row)
              const lookUp = c.key === 'pages' && !editing && needsLength(ed) && ed && store.canEdit(ed)
              return (
                <div key={c.key} className={`detail d-${c.key} ${editing ? 'editing' : ''} ${c.kind === 'longtext' ? 'long' : ''}`}>
                  <dt>{LABELS[c.key] ?? c.label}</dt>
                  <dd>
                    {editing ? cell.editor(c, row) : canChange ? (
                      <button className="detail-btn" onClick={() => cell.startEdit(c, row)} aria-label={`${c.label}: ${text || 'empty'}. Change`}>
                        {text || <span className="cell-empty">Add</span>}
                      </button>
                    ) : (
                      <span className="detail-ro" title={lock ? 'Added by another reader: only the admin can change this' : undefined}>
                        {lock && <Lock size={11} />} {text || <span className="cell-empty">—</span>}
                      </span>
                    )}
                    {lookUp && (
                      <button className="btn btn-ghost xs" disabled={!!fill.progress} onClick={() => fill.run([{ edition: ed, work }])}>
                        {fill.progress ? <Loader2 size={12} className="spin" /> : <Search size={12} />} Look it up
                      </button>
                    )}
                  </dd>
                </div>
              )
            })}
          </dl>
        </section>
      ))}
    </div>
  )
}
