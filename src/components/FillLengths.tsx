import { Loader2, Ruler } from 'lucide-react'
import { useMemo, useState } from 'react'
import { findLengths, needsLength, type LengthJob } from '../lib/fillLengths'
import { plural } from '../lib/util'
import { useStore } from '../state/store'
import { useToast } from '../state/toast'

/** Your books (the editions you own and the ones you've read) that have no page count. */
export function useMissingLengths(): LengthJob[] {
  const { data, works, editions } = useStore()
  return useMemo(() => {
    const ids = new Set<string>()
    for (const e of data.entries) if (e.editionId) ids.add(e.editionId)
    for (const r of data.reads) if (r.editionId) ids.add(r.editionId)
    const jobs: LengthJob[] = []
    for (const id of ids) {
      const edition = editions.get(id)
      const work = edition && works.get(edition.workId)
      if (edition && work && needsLength(edition)) jobs.push({ edition, work })
    }
    return jobs
  }, [data.entries, data.reads, works, editions])
}

/** Looks up and saves page counts for books that don't have one. */
export function useFillLengths() {
  const store = useStore()
  const toast = useToast()
  const missing = useMissingLengths()
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const run = async (jobs = missing) => {
    const editable = jobs.filter((j) => store.canEdit(j.edition))
    if (!editable.length) { toast('There’s nothing here Folio can fill in.'); return 0 }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      toast('You’re offline. Looking up page counts needs a connection.', { tone: 'error' })
      return 0
    }
    setProgress({ done: 0, total: editable.length })
    const found = await findLengths(editable, (done, total) => setProgress({ done, total }))
    for (const j of editable) {
      const pages = found.get(j.edition.id)
      if (pages) store.saveEdition({ ...j.edition, pages })
    }
    setProgress(null)
    const left = editable.length - found.size
    toast(found.size
      ? `Found page counts for ${plural(found.size, 'book')}.${left ? ` ${left} couldn’t be found; add those on the book’s page.` : ''}`
      : 'Couldn’t find page counts for these books online. You can add them on each book’s page.')
    return found.size
  }
  return { missing, progress, run }
}

/** "Fill in page counts" button with live progress. */
export function FillLengthsButton({ className = 'btn btn-ghost sm', label = 'Fill in page counts' }: { className?: string; label?: string }) {
  const { missing, progress, run } = useFillLengths()
  if (!missing.length && !progress) return null
  return (
    <button className={className} disabled={!!progress} onClick={() => run()}>
      {progress ? <><Loader2 size={14} className="spin" /> Looking up {progress.done} of {progress.total}…</> : <><Ruler size={14} /> {label}</>}
    </button>
  )
}
