import type { Edition, Entry, LogPoint, Read, Settings, Shelf, Snapshot, Work } from './types'

/**
 * Everything the UI needs from storage. The app keeps the user's whole
 * library in memory (personal libraries are small) and writes through
 * optimistically, so the interface never waits on the network.
 */
export interface Backend {
  kind: 'local' | 'cloud'
  userLabel?: string
  loadAll(): Promise<Snapshot>
  saveWork(w: Work): Promise<void>
  saveEdition(e: Edition): Promise<void>
  saveEntry(e: Entry): Promise<void>
  deleteEntry(id: string): Promise<void>
  saveRead(r: Read): Promise<void>
  deleteRead(id: string): Promise<void>
  saveLog(l: LogPoint): Promise<void>
  saveShelf(s: Shelf): Promise<void>
  deleteShelf(id: string): Promise<void>
  saveSettings(s: Settings): Promise<void>
  /** Bulk write used by imports. */
  saveMany(s: Partial<Snapshot>): Promise<void>
  /** Search the shared catalogue (everything every user has added). */
  searchCatalog(title: string, authors: string[]): Promise<{ works: Work[]; editions: Edition[] }>
  /** Store a processed cover image; returns a URL usable in <img>. */
  uploadCover(blob: Blob): Promise<string>
  signOut?(): Promise<void>
  wipe(): Promise<void>
}
