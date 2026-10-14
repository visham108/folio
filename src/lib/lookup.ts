import { coreTitle, fold } from './match'
import { cleanIsbn, isbn10to13 } from './util'

/** Metadata from public book databases, used to pre-fill the add form. */
export interface LookupResult {
  source: 'google' | 'openlibrary'
  title: string
  subtitle?: string
  authors: string[]
  publisher?: string
  publishedDate?: string
  firstPublished?: number
  pages?: number
  isbn13?: string
  isbn10?: string
  coverUrl?: string
  description?: string
  genres: string[]
  language?: string
}

const GENRE_NOISE = /fiction \/ general|general|accessible book|protected daisy|in library|large type books|nyt:|new york times/i

function tidyGenres(xs: string[] = []): string[] {
  const out = new Set<string>()
  for (const x of xs) {
    for (const part of x.split(/\s*\/\s*/)) {
      const p = part.trim()
      if (p && p.length < 28 && !GENRE_NOISE.test(p)) out.add(p.replace(/\b\w/g, (c) => c.toUpperCase()))
    }
  }
  return [...out].slice(0, 6)
}

async function google(q: string, signal?: AbortSignal): Promise<LookupResult[]> {
  const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=12&printType=books`, { signal })
  if (!res.ok) return []
  const json = await res.json()
  return (json.items ?? []).map((it: any): LookupResult => {
    const v = it.volumeInfo ?? {}
    const ids: { type: string; identifier: string }[] = v.industryIdentifiers ?? []
    const thumb: string | undefined = v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail
    return {
      source: 'google',
      title: v.title ?? '',
      subtitle: v.subtitle,
      authors: v.authors ?? [],
      publisher: v.publisher,
      publishedDate: v.publishedDate,
      pages: v.pageCount || undefined,
      isbn13: ids.find((i) => i.type === 'ISBN_13')?.identifier,
      isbn10: ids.find((i) => i.type === 'ISBN_10')?.identifier,
      coverUrl: thumb ? thumb.replace('http://', 'https://').replace('&edge=curl', '') + '&fife=w600' : undefined,
      description: v.description,
      genres: tidyGenres(v.categories),
      language: v.language,
    }
  })
}

async function openLibrary(q: string, signal?: AbortSignal): Promise<LookupResult[]> {
  const fields = 'title,subtitle,author_name,first_publish_year,isbn,number_of_pages_median,cover_i,subject,publisher,language'
  const res = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=10&fields=${fields}`, { signal })
  if (!res.ok) return []
  const json = await res.json()
  return (json.docs ?? []).map((d: any): LookupResult => {
    const isbns: string[] = d.isbn ?? []
    return {
      source: 'openlibrary',
      title: d.title ?? '',
      subtitle: d.subtitle,
      authors: d.author_name ?? [],
      publisher: d.publisher?.[0],
      firstPublished: d.first_publish_year,
      pages: d.number_of_pages_median,
      isbn13: isbns.find((i) => i.length === 13),
      isbn10: isbns.find((i) => i.length === 10),
      coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : undefined,
      genres: tidyGenres((d.subject ?? []).slice(0, 8)),
      language: d.language?.[0],
    }
  })
}

const settle = async <T,>(p: Promise<T[]>) => p.catch(() => [] as T[])

export async function searchBooks(query: string, signal?: AbortSignal): Promise<LookupResult[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const isbn = cleanIsbn(q)
  const [g, o] = await Promise.all([
    settle(google(isbn ? `isbn:${isbn}` : q, signal)),
    settle(openLibrary(isbn ? `isbn:${isbn}` : q, signal)),
  ])
  // Interleave, preferring Google's richer records, and merge duplicates so
  // gaps (page count, cover) are filled from the other source.
  const merged: LookupResult[] = []
  const key = (r: LookupResult) => coreTitle(r.title) + '|' + fold(r.authors[0]?.split(' ').pop() ?? '')
  for (const r of [...g, ...o]) {
    if (!r.title) continue
    const k = key(r)
    const hit = merged.find((m) => key(m) === k)
    if (hit) {
      hit.pages ??= r.pages
      hit.coverUrl ??= r.coverUrl
      hit.firstPublished ??= r.firstPublished
      hit.isbn13 ??= r.isbn13
      if (!hit.genres.length) hit.genres = r.genres
    } else merged.push({ ...r })
  }
  for (const m of merged) if (!m.isbn13 && m.isbn10) m.isbn13 = isbn10to13(m.isbn10)
  return merged.slice(0, 12)
}
