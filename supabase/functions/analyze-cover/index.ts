// Reads a phone photo of a book: where the cover's four corners are (for the
// perspective crop in the app) and what the title/author/format appear to be.
import { cors, json, structured } from '../_shared/claude.ts'

const SYSTEM = `You look at a photo of a book (or an audiobook/ebook cover on a screen) and report:
- corners: the four corners of the front cover in the photo as [x, y] pairs normalised to 0..1 of the image width and height, in the order top-left, top-right, bottom-right, bottom-left. Hug the cover's edges; exclude the spine, hands, table and background. If the cover fills the frame, use the frame edges.
- title, subtitle and authors exactly as printed (fix ALL-CAPS to normal title case). Omit any you can't read confidently.
- format: "audiobook" if it's clearly an audiobook (e.g. an Audible-style square cover or audio app), "ebook" if it's a cover shown on an e-reader, "hardcover" if a dust jacket or hard boards are visible, otherwise "paperback".`

const pt = { type: 'array', items: { type: 'number' } }
const schema = {
  type: 'object',
  properties: {
    corners: { type: 'array', items: pt },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    authors: { type: 'array', items: { type: 'string' } },
    format: { type: 'string', enum: ['hardcover', 'paperback', 'audiobook', 'ebook'] },
  },
  required: ['corners', 'format'],
  additionalProperties: false,
}

type Result = { corners?: number[][]; title?: string; subtitle?: string; authors?: string[]; format?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { image } = (await req.json()) as { image?: string }
    if (!image || image.length > 7_000_000) return json({ error: 'image (base64 JPEG, ≤5MB) is required' }, 400)
    const r = await structured<Result>({
      system: SYSTEM,
      effort: 'medium',
      schema,
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
        { type: 'text', text: 'Analyse this book photo.' },
      ],
    })
    if (!r) return json({ error: 'no result' }, 502)
    const ok = Array.isArray(r.corners) && r.corners.length === 4 &&
      r.corners.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && n >= -0.05 && n <= 1.05))
    return json({
      corners: ok ? r.corners!.map(([x, y]) => [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))]) : undefined,
      title: r.title || undefined,
      subtitle: r.subtitle || undefined,
      authors: r.authors?.filter(Boolean),
      format: r.format,
    })
  } catch (e) {
    console.error(e)
    return json({ error: 'analysis failed' }, 500)
  }
})
