import { Download, FileUp, LogOut, Moon, Sparkles, Sun, SunMoon, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Field, Segmented } from '../components/ui'
import { importGoodreads } from '../lib/goodreads'
import { sampleLibrary } from '../lib/sample'
import type { Settings, Snapshot } from '../lib/types'
import { useStore } from '../state/store'
import { useToast } from '../state/toast'

export function SettingsPage() {
  const store = useStore()
  const { data, backend } = store
  const toast = useToast()
  const s = data.settings
  const grFile = useRef<HTMLInputElement>(null)
  const jsonFile = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [goal, setGoal] = useState(String(s.yearlyGoal))

  useEffect(() => {
    if (location.hash.includes('import')) document.getElementById('import')?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const runImport = async (file: File) => {
    setBusy('Importing…')
    try {
      const text = await file.text()
      const res = importGoodreads(text, data)
      await store.importData(res.data)
      toast(`Imported ${res.data.entries.length} books (${res.added} new to Folio, ${res.matched} matched existing${res.skipped ? `, ${res.skipped} already on your shelves` : ''})`)
    } catch (e) {
      toast((e as Error).message, { tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ app: 'folio', version: 1, exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `folio-library-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  const importJson = async (file: File) => {
    setBusy('Restoring…')
    try {
      const parsed = JSON.parse(await file.text()) as Partial<Snapshot> & { app?: string }
      if (parsed.app !== 'folio') throw new Error('That file isn’t a Folio export.')
      await store.importData({ works: parsed.works, editions: parsed.editions, entries: parsed.entries, reads: parsed.reads, logs: parsed.logs, shelves: parsed.shelves })
      if (parsed.settings) store.saveSettings(parsed.settings)
      toast('Library restored')
    } catch (e) {
      toast((e as Error).message, { tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="page settings">
      <header className="page-head">
        <p className="eyebrow">Settings</p>
        <h1 className="display">Make it <em>yours.</em></h1>
      </header>

      <section className="card form-card">
        <h3>You</h3>
        <div className="form-grid">
          <Field label="Name"><input className="input" defaultValue={s.displayName ?? ''} onBlur={(e) => store.saveSettings({ displayName: e.target.value || undefined })} placeholder="What should we call you?" /></Field>
          <Field label="Books per year goal">
            <input className="input" inputMode="numeric" value={goal} onChange={(e) => setGoal(e.target.value)} onBlur={() => {
              const n = parseInt(goal, 10)
              if (n > 0 && n < 1000) store.saveSettings({ yearlyGoal: n })
              else setGoal(String(s.yearlyGoal))
            }} />
          </Field>
          <Field label="An hour of listening counts as" hint="Used for “combined” stats. Around 30 pages an hour at a typical narration pace." className="span-2">
            <div className="inline-num">
              <input type="range" className="range" min={10} max={60} step={1} value={s.audioPagesPerHour} style={{ ['--pct' as string]: `${((s.audioPagesPerHour - 10) / 50) * 100}%` }}
                onChange={(e) => store.saveSettings({ audioPagesPerHour: +e.target.value })} aria-label="Pages per hour of audio" />
              <b>{s.audioPagesPerHour} pages</b>
            </div>
          </Field>
          <Field label="Appearance" className="span-2">
            <Segmented<Settings['theme']> label="Theme" value={s.theme} onChange={(theme) => store.saveSettings({ theme })}
              options={[{ id: 'system', label: <><SunMoon size={14} /> Auto</> }, { id: 'light', label: <><Sun size={14} /> Light</> }, { id: 'dark', label: <><Moon size={14} /> Dark</> }]} />
          </Field>
        </div>
      </section>

      <section className="card form-card" id="import">
        <h3>Bring your books</h3>
        <p className="muted">On Goodreads go to <b>My Books → Import and export → Export library</b>, then drop the CSV here. Shelves, ratings, reviews, read dates and reread counts all come across, and books already in Folio are matched instead of duplicated.</p>
        <div className="btn-row">
          <button className="btn btn-primary" disabled={!!busy} onClick={() => grFile.current?.click()}><FileUp size={16} /> {busy ?? 'Import Goodreads CSV'}</button>
          {backend?.kind === 'local' && data.entries.length === 0 && (
            <button className="btn btn-ghost" onClick={async () => { await store.importData(sampleLibrary()); toast('Sample library loaded. Have a look at Stats.') }}>
              <Sparkles size={16} /> Load a sample library
            </button>
          )}
        </div>
        <input ref={grFile} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) runImport(f); e.target.value = '' }} />
      </section>

      <section className="card form-card">
        <h3>Your data</h3>
        <p className="muted">It’s yours. Export everything as JSON at any time, or restore from an export.</p>
        <div className="btn-row">
          <button className="btn btn-soft" onClick={exportJson}><Download size={16} /> Export JSON</button>
          <button className="btn btn-ghost" onClick={() => jsonFile.current?.click()}><Upload size={16} /> Restore from export</button>
        </div>
        <input ref={jsonFile} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = '' }} />
      </section>

      <section className="card form-card">
        <h3>Account</h3>
        <p className="muted">
          {backend?.kind === 'cloud'
            ? <>Signed in as <b>{backend.userLabel}</b>. Your library syncs across devices.</>
            : <>Your library lives in this browser only. Sign in with Google to sync it everywhere. Export first, then restore after signing in to bring these books along.</>}
        </p>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={() => store.signOut()}><LogOut size={16} /> {backend?.kind === 'cloud' ? 'Sign out' : 'Switch to an account'}</button>
          <button className="btn btn-ghost danger" onClick={async () => {
            if (!confirm('Delete every book, read and shelf in your library? This can’t be undone.')) return
            await store.wipe()
            toast('Library cleared')
          }}><Trash2 size={16} /> Delete my library</button>
        </div>
      </section>
    </div>
  )
}
