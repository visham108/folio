import { Link } from 'react-router-dom'
import type { Completion } from '../lib/stats'
import { monthName, plural, today } from '../lib/util'
import { Cover } from './Cover'

const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * The year as a diary: one page per month with the books you finished and a small calendar of the
 * days you read (darker = more pages, or listening converted to pages).
 */
export function ReadingDiary({ year, items, heat }: { year: number; items: Completion[]; heat: Map<string, number> }) {
  const now = new Date()
  const lastMonth = year === now.getFullYear() ? now.getMonth() : year > now.getFullYear() ? -1 : 11
  const max = Math.max(1, ...heat.values())
  const todayIso = today()
  const months = Array.from({ length: lastMonth + 1 }, (_, m) => m).reverse()
  if (!months.length) return null
  return (
    <section className="section">
      <div className="section-head"><h2>Reading diary</h2><span className="muted small">Month by month, newest first</span></div>
      <div className="diary">
        {months.map((m) => {
          const books = items.filter((c) => c.year === year && c.month === m)
          const first = new Date(year, m, 1)
          const days = new Date(year, m + 1, 0).getDate()
          const offset = (first.getDay() + 6) % 7 // weeks start on Monday
          const cells = Array.from({ length: days }, (_, i) => {
            const d = `${year}-${String(m + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`
            const v = heat.get(d) ?? 0
            return { d, day: i + 1, future: d > todayIso, level: v <= 0 ? 0 : Math.min(4, 1 + Math.floor((v / max) * 4)) }
          })
          const readDays = cells.filter((c) => c.level > 0).length
          return (
            <article key={m} className="diary-month card" aria-label={`${FULL_MONTHS[m]} ${year}`}>
              <header>
                <h3>{FULL_MONTHS[m]}</h3>
                <span className="muted small">{books.length ? plural(books.length, 'book') : 'No books finished'}{readDays ? ` · ${plural(readDays, 'reading day')}` : ''}</span>
              </header>
              <div className="diary-cal" role="img" aria-label={`${plural(readDays, 'day')} with reading in ${FULL_MONTHS[m]}`}>
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="diary-dow" aria-hidden>{d}</span>)}
                {Array.from({ length: offset }, (_, i) => <span key={`x${i}`} aria-hidden />)}
                {cells.map((c) => <span key={c.d} className={`diary-day l${c.level} ${c.future ? 'future' : ''}`} title={`${monthName(m)} ${c.day}`} aria-hidden />)}
              </div>
              {books.length > 0 && (
                <div className="diary-covers">
                  {books.map((c) => (
                    <Link key={c.read.id} to={`/book/${c.work.id}`} title={c.work.title} aria-label={c.work.title}>
                      <Cover work={c.work} edition={c.edition} size="xs" badge={false} />
                    </Link>
                  ))}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
