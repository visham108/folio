import { CloudUpload, HardDriveDownload } from 'lucide-react'
import { useState } from 'react'
import { backupDue, downloadBackup, snoozeBackup } from '../lib/backup'
import { plural } from '../lib/util'
import { useStore } from '../state/store'
import { useToast } from '../state/toast'
import { ConfirmSheet } from './ui'

/** One-off prompts shown at the top of Today: stranded device books, and backups. */
export function Notices() {
  const store = useStore()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [backupHidden, setBackupHidden] = useState(false)
  const showBackup = !backupHidden && store.backend?.kind === 'cloud' && backupDue(store.data.entries.length)

  if (!store.deviceBooks && !showBackup) return null
  return (
    <div className="notices">
      {store.deviceBooks > 0 && (
        <div className="notice card" role="region" aria-label="Books on this device">
          <CloudUpload size={20} />
          <div className="notice-body">
            <b>{plural(store.deviceBooks, 'book')} saved on this device from before you signed in</b>
            <span className="muted small">Move them into your account so they sync everywhere. Books already in Folio are matched, not duplicated.</span>
          </div>
          <div className="notice-actions">
            <button className="btn btn-primary sm" disabled={busy} onClick={async () => {
              setBusy(true)
              try {
                const n = await store.moveDeviceBooks()
                toast(`Moved ${plural(n, 'book')} into your account`)
              } catch (e) {
                toast('Couldn’t move them: ' + (e as Error).message + '. Nothing was removed from this device.', { tone: 'error' })
              } finally { setBusy(false) }
            }}>{busy ? 'Moving…' : 'Move them'}</button>
            <button className="btn btn-ghost sm" disabled={busy} onClick={() => store.dismissDeviceBooks(false)}>Not now</button>
            <button className="btn btn-ghost sm danger" disabled={busy} onClick={() => setConfirmDiscard(true)}>Discard</button>
          </div>
          <ConfirmSheet open={confirmDiscard} title="Discard the books on this device?" confirmLabel="Discard" danger
            onClose={() => setConfirmDiscard(false)}
            onConfirm={async () => { setConfirmDiscard(false); await store.dismissDeviceBooks(true); toast('Removed from this device') }}>
            <p>The {plural(store.deviceBooks, 'book')} saved in this browser before you signed in will be deleted. Your account isn’t affected.</p>
          </ConfirmSheet>
        </div>
      )}
      {showBackup && (
        <div className="notice card" role="region" aria-label="Backup reminder">
          <HardDriveDownload size={20} />
          <div className="notice-body">
            <b>Keep a copy of your library</b>
            <span className="muted small">A monthly download takes a second and means your reading history is never in one place only.</span>
          </div>
          <div className="notice-actions">
            <button className="btn btn-primary sm" onClick={() => { downloadBackup(store.data); setBackupHidden(true); toast('Backup downloaded') }}>Download backup</button>
            <button className="btn btn-ghost sm" onClick={() => { snoozeBackup(); setBackupHidden(true) }}>Remind me later</button>
          </div>
        </div>
      )}
    </div>
  )
}
