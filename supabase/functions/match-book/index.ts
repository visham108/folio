// Decides whether a book a user is adding is the same *work* as an existing
// catalogue entry (so it becomes another edition rather than a duplicate).
import { cors, json, structured } from '../_shared/claude.ts'

interface Candidate { id: string; title: string; subtitle?: string; authors: string[]; firstPublished?: number; editionTitles?: string[] }
interface Body { query: { title: string; authors: string[] }; candidates: Candidate[] }

const SYSTEM = `You match books for a reading-tracker catalogue. A "work" is the abstract book; editions are printings, translations, audiobooks, retitled regional releases, or anniversary editions of the same work.

Decide whether the book being added is the same work as one of the candidates. Count as the same work: different formats, translations, UK/US retitlings (e.g. "Harry Potter and the Philosopher's Stone" and "...Sorcerer's Stone"), subtitle differences, and author-name variants (initials, transliterations). Count as different works: sequels or other volumes in a series, companion books, study guides or summaries of a book, abridged adaptations for children published as separate books, and different books that share a title.

If none of the candidates is clearly the same work, return null for workId. Keep the reason to one short sentence a reader would find helpful.`

const schema = {
  type: 'object',
  properties: {
    workId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    reason: { type: 'string' },
  },
  required: ['workId', 'reason'],
  additionalProperties: false,
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const body = (await req.json()) as Body
    if (!body?.query?.title || !Array.isArray(body.candidates) || !body.candidates.length) {
      return json({ error: 'query.title and candidates are required' }, 400)
    }
    const candidates = body.candidates.slice(0, 8)
    const result = await structured<{ workId: string | null; reason: string }>({
      system: SYSTEM,
      effort: 'low',
      schema,
      content: [{
        type: 'text',
        text: `Book being added:\n${JSON.stringify(body.query)}\n\nCandidates:\n${JSON.stringify(candidates, null, 1)}`,
      }],
    })
    if (!result) return json({ error: 'no decision' }, 502)
    // Only accept ids we actually sent.
    if (result.workId && !candidates.some((c) => c.id === result.workId)) result.workId = null
    return json(result)
  } catch (e) {
    console.error(e)
    return json({ error: 'match failed' }, 500)
  }
})
