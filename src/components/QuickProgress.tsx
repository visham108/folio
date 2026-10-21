import { progressInfo, quickSteps } from '../lib/progress'
import type { Read } from '../lib/types'
import { useStore } from '../state/store'
import { useToast } from '../state/toast'

/** Moves a read forward by a fixed amount, with an undo. Reaching the end asks to finish instead. */
export function useQuickLog() {
  const store = useStore()
  const toast = useToast()
  return (read: Read, by: number, onFinish: () => void) => {
    const entry = store.entries.get(read.entryId)
    const ed = store.editions.get(read.editionId ?? entry?.editionId ?? '')
    const work = entry && store.works.get(entry.workId)
    const info = progressInfo(read, ed)
    const next = Math.round(info.value + by)
    if (next >= info.total) { onFinish(); return }
    const before = read.progress ?? 0
    store.logProgress(read.id, next)
    toast(`${work?.title ?? 'Progress'}: ${progressInfo({ ...read, progress: next }, ed).label}`, {
      action: { label: 'Undo', run: () => store.logProgress(read.id, before) },
    })
  }
}

/** "+10 pages", "+25 pages" (or minutes, or percent) for a book you're reading. */
export function QuickSteps({ read, onFinish, size = 'sm' }: { read: Read; onFinish: () => void; size?: 'sm' | 'md' }) {
  const store = useStore()
  const quick = useQuickLog()
  const entry = store.entries.get(read.entryId)
  const ed = store.editions.get(read.editionId ?? entry?.editionId ?? '')
  return (
    <>
      {quickSteps(progressInfo(read, ed).unit).map((s) => (
        <button key={s.by} className={`btn btn-soft ${size === 'sm' ? 'sm' : ''}`} onClick={() => quick(read, s.by, onFinish)}>{s.label}</button>
      ))}
    </>
  )
}
