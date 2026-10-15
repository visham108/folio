import { searchBooks, type LookupResult } from './lookup'
import { authorSimilarity, titleSimilarity } from './match'
import type { Edition, Work } from './types'
import { cleanIsbn } from './util'

/**
 * Finds page counts for editions that don't have one, from Google Books and Open Library:
 * by ISBN when there is one, otherwise by a confident title + author match. Audiobook
 * lengths aren't published by either service, so those are left alone.
 */
export interface LengthJob { edition: Edition; work: Work }

/** Editions worth looking up: print or ebook, no page count yet. */
export const needsLength = (e?: Edition) => !!e && e.format !== 'audiobook' && !e.pages

function pick(job: LengthJob, results: LookupResult[], byIsbn: boolean): number | undefined {
  const withPages = results.filter((r) => r.pages && r.pages > 0 && r.pages < 20000)
  if (byIsbn) {
    const isbn = cleanIsbn(job.edition.isbn13 ?? job.edition.isbn10)
    return (withPages.find((r) => r.isbn13 === isbn || r.isbn10 === isbn) ?? withPages[0])?.pages
  }
  // Without an ISBN only accept a result that's clearly the same book.
  const best = withPages.find((r) =>
    titleSimilarity(job.work.title, r.title) >= 0.92 && authorSimilarity(job.work.authors, r.authors) >= 0.85)
  return best?.pages
}

export async function findLengths(
  jobs: LengthJob[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Map<string, number>> {
  const found = new Map<string, number>()
  let done = 0
  let next = 0
  // A few at a time, to stay well inside the services' rate limits.
  const worker = async () => {
    while (next < jobs.length && !signal?.aborted) {
      const job = jobs[next++]
      const isbn = cleanIsbn(job.edition.isbn13 ?? job.edition.isbn10)
      try {
        let pages: number | undefined
        if (isbn) pages = pick(job, await searchBooks(isbn, signal), true)
        if (!pages) pages = pick(job, await searchBooks(`${job.work.title} ${job.work.authors[0] ?? ''}`, signal), false)
        if (pages) found.set(job.edition.id, pages)
      } catch { /* skip this one */ }
      onProgress?.(++done, jobs.length)
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return found
}
