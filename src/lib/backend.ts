import type { Edition, Entry, LogPoint, Read, Settings, Shelf, Snapshot, Work } from './types'

/**
 * Everything the UI needs from storage. The app keeps the user's whole
 * library in memory (personal libraries are small) and writes through
 * optimistically, so the interface never waits on the network.
 */
export interface Backend {
  kind: 'local' | 'cloud'
  userLabel?: string
  /** Signed-in user id (cloud only). */
  userId?: string
  /** The single super admin may edit or remove any catalogue record. */
  isAdmin: boolean
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
  /** Batch lookup of the shared catalogue by ISBN and main title, used before imports and adds. */
  catalogueFor(q: { isbns: string[]; titles: string[] }): Promise<{ works: Work[]; editions: Edition[] }>
  /** Every catalogue book in the named series (for series pages and "next in series"). */
  seriesWorks(names: string[]): Promise<{ works: Work[]; editions: Edition[] }>
  /** Load one catalogue book (and its editions) that isn't on your shelves, e.g. from a shared link. */
  fetchWork(id: string): Promise<{ work: Work; editions: Edition[] } | null>
  /** Admin only: remove an edition from the shared catalogue. */
  deleteEdition(id: string): Promise<void>
  /** Admin only: fold a duplicate book into another (editions and readers' shelves move with it). */
  mergeWorks(fromId: string, intoId: string): Promise<void>
  /** Admin only: recent catalogue changes for a book and its editions. */
  history(recordIds: string[]): Promise<CatalogueChange[]>
  /** Store a processed cover image; returns a URL usable in <img>. */
  uploadCover(blob: Blob): Promise<string>
  signOut?(): Promise<void>
  wipe(): Promise<void>
}

export interface CatalogueChange {
  id: number
  table: 'works' | 'editions'
  recordId: string
  action: 'insert' | 'update' | 'delete'
  changedBy?: string
  changedAt: string
  /** Fields whose value changed (for updates). */
  fields: string[]
}
