import { Download, FileSpreadsheet, FileUp, LogOut, Moon, ShieldCheck, Sparkles, Sun, SunMoon, Trash2, Upload } from 'lucide-react'
import { nameCase } from '../lib/titleCase'
import { useEffect, useRef, useState } from 'react'
import { ConfirmSheet, Field, Segmented } from '../components/ui'
import { ImportSheet } from '../components/ImportSheet'
import { sampleLibrary } from '../lib/sample'
import { downloadBackup, lastBackup } from '../lib/backup'
import { downloadText, fullCsv, goodreadsCsv } from '../lib/exporter'
import { fmtDate, localIso, plural, today } from '../lib/util'
import type { Settings, Snapshot } from '../lib/types'
import { useStore } from '../state/store'
import { useToast } from '../state/toast'

export function SettingsPage() {
  const store = useStore()
  const { data, backend } = store
  const toast = useToast()
  const s = data.settings
  const jsonFile = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [goal, setGoal] = useState(String(s.yearlyGoal))
  const [importOpen, setImportOpen] = useState(false)
  const [last, setLast] = useState(lastBackup())
  const [confirmWipe, setConfirmWipe] = useState(false)

  useEffect(() => {
    if (location.hash.includes('import')) {
      document.getElementById('import')?.scrollIntoView({ behavior: 'smooth' })
      setImportOpen(true)
    }
  }, [])

  const exportJson = () => { downloadBackup(data); setLast(lastBackup()) }

  const importJson = async (file: File) => {
    setBusy('Restoring…')
    try {
      const parsed = JSON.parse(await file.text()) as Partial<Snapshot> & { app?: string }
      if (parsed.app !== 'folio') throw new Error('That file isn’t a Folio export.')
      const res = await store.mergeIn({
        works: parsed.works ?? [], editions: parsed.editions ?? [], entries: parsed.entries ?? [],
        reads: parsed.reads ?? [], logs: parsed.logs ?? [], shelves: parsed.shelves ?? [],
      })
      if (parsed.settings) store.saveSettings(parsed.settings)
      toast(res.matched
        ? `Restored ${plural(res.books, 'book')}. ${res.matched} were already here, so they were combined, not duplicated.`
        : `Restored ${plural(res.books, 'book')}`)
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
          <Field label="Name"><input className="input" defaultValue={s.displayName ?? ''} onBlur={(e) => {
            e.target.value = nameCase(e.target.value)
            store.saveSettings({ displayName: e.target.value || undefined })
          }} placeholder="What should we call you?" /></Field>
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
        <p className="muted">Import the CSV export from Goodreads, StoryGraph, LibraryThing or any spreadsheet. Folio works out which column is which (titles, authors, statuses, ratings, read dates, rereads, shelves) and shows you the mapping to check before anything is added. Books already in Folio are matched instead of duplicated.</p>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={() => setImportOpen(true)}><FileUp size={16} /> Import a CSV</button>
          {backend?.kind === 'local' && data.entries.length === 0 && (
            <button className="btn btn-ghost" onClick={async () => { await store.importData(sampleLibrary()); toast('Sample library loaded. Have a look at Stats.') }}>
              <Sparkles size={16} /> Load a sample library
            </button>
          )}
        </div>
        <ImportSheet open={importOpen} onClose={() => setImportOpen(false)} />
      </section>

      <section className="card form-card">
        <h3>Your data</h3>
        <p className="muted">It’s yours. Download everything as a backup at any time, or restore from one. Restoring adds to your library and never duplicates books you already have.{last && <> Last backup: <b>{fmtDate(localIso(new Date(last)))}</b>.</>}</p>
        <div className="btn-row">
          <button className="btn btn-soft" onClick={exportJson}><Download size={16} /> Download backup</button>
          <button className="btn btn-ghost" disabled={!!busy} onClick={() => jsonFile.current?.click()}><Upload size={16} /> {busy ?? 'Restore from export'}</button>
        </div>
        <input ref={jsonFile} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = '' }} />
        <h4 className="sub-head">Export as a spreadsheet</h4>
        <p className="muted small">For other apps or Excel. Goodreads only stores whole stars, so half-star ratings are rounded in that file.</p>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={() => { downloadText(goodreadsCsv(data), `folio-goodreads-${today()}.csv`); toast('Goodreads-format CSV downloaded') }}>
            <FileSpreadsheet size={16} /> Goodreads / StoryGraph CSV
          </button>
          <button className="btn btn-ghost" onClick={() => { downloadText(fullCsv(data), `folio-library-${today()}.csv`); toast('Full spreadsheet downloaded') }}>
            <FileSpreadsheet size={16} /> Full spreadsheet (one row per read)
          </button>
        </div>
      </section>

      <section className="card form-card">
        <h3>Account</h3>
        <p className="muted">
          {backend?.kind === 'cloud'
            ? <>Signed in as <b>{backend.userLabel}</b>. Your library syncs across devices.{store.isAdmin && <span className="pill tiny admin-pill"><ShieldCheck size={11} /> Super admin</span>}</>
            : <>Your library lives in this browser only. Sign in with Google to sync it everywhere; Folio offers to bring these books into your account when you do.</>}
        </p>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={() => store.signOut()}><LogOut size={16} /> {backend?.kind === 'cloud' ? 'Sign out' : 'Switch to an account'}</button>
          <button className="btn btn-ghost danger" onClick={() => setConfirmWipe(true)}><Trash2 size={16} /> Delete my library</button>
        </div>
        <p className="muted small"><a className="link" href="./privacy.html">Privacy policy</a></p>
        <ConfirmSheet
          open={confirmWipe}
          title="Delete your whole library?"
          confirmLabel="Delete everything"
          danger
          onClose={() => setConfirmWipe(false)}
          onConfirm={async () => {
            setConfirmWipe(false)
            await store.wipe()
            toast('Library deleted')
          }}
        >
          <p>All {data.entries.length} books on your shelves, their reading history and your shelves will be deleted. This can’t be undone, so export a copy first if you might want it back.</p>
        </ConfirmSheet>
      </section>
    </div>
  )
}
