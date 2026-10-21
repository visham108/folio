import { Download, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { moodProfile, type Completion, type YearSummary } from '../lib/stats'
import { coverPalette, fmtNumber, monthName, plural } from '../lib/util'
import { useToast } from '../state/toast'
import { corsReadable } from './Cover'
import { Segmented, Sheet } from './ui'

type Theme = 'ink' | 'paper'
const W = 1080, H = 1350, PAD = 80
const THEMES: Record<Theme, { bg: string; ink: string; muted: string; accent: string; line: string }> = {
  ink: { bg: '#1d1a16', ink: '#f2ede4', muted: '#a59c8e', accent: '#e07a4f', line: 'rgba(255,245,230,0.16)' },
  paper: { bg: '#f6f1e9', ink: '#1d1a16', muted: '#6e665a', accent: '#c4572e', line: 'rgba(29,26,22,0.15)' },
}
const SERIF = 'Fraunces, Georgia, serif'
const SANS = 'Geist, system-ui, sans-serif'
// lucide "book-open", the Folio mark.
const MARK = ['M12 7v14', 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z']

/** A picture of your year in books, sized for sharing (4:5), with a download and share button. */
export function YearCardSheet({ sum, open, onClose }: { sum: YearSummary; open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [theme, setTheme] = useState<Theme>('ink')
  const [png, setPng] = useState<{ url: string; blob: Blob }>()
  useEffect(() => {
    if (!open) return
    let live = true
    let url = ''
    setPng(undefined)
    drawYearCard(sum, theme).then((blob) => {
      if (!live || !blob) return
      url = URL.createObjectURL(blob)
      setPng({ url, blob })
    })
    return () => { live = false; if (url) URL.revokeObjectURL(url) }
  }, [open, sum, theme])

  const name = `folio-${sum.year}.png`
  const file = png && new File([png.blob], name, { type: 'image/png' })
  const canShare = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Share your ${sum.year}`}
      footer={
        <>
          {canShare && (
            <button className="btn btn-ghost" onClick={() => navigator.share({ files: [file!], title: `My ${sum.year} in books` }).catch((e) => {
              if (e?.name !== 'AbortError') toast('Couldn’t share it. Try downloading instead.')
            })}>
              <Share2 size={16} /> Share
            </button>
          )}
          {png ? (
            <a className="btn btn-primary" href={png.url} download={name}><Download size={16} /> Download image</a>
          ) : (
            <button className="btn btn-primary" disabled><Download size={16} /> Download image</button>
          )}
        </>
      }
    >
      <div>
        <Segmented<Theme> size="sm" label="Background" value={theme} onChange={setTheme} options={[{ id: 'ink', label: 'Dark' }, { id: 'paper', label: 'Light' }]} />
      </div>
      <div className="year-card-preview" aria-busy={!png}>
        {png && <img src={png.url} alt={`Your ${sum.year} in books: ${plural(sum.books, 'book')}, with their covers`} />}
      </div>
      <p className="muted small">Covers from other sites can’t always be copied into a picture; those books get their Folio cover instead.</p>
    </Sheet>
  )
}

async function drawYearCard(sum: YearSummary, theme: Theme): Promise<Blob | null> {
  const t = THEMES[theme]
  await Promise.all([`400 200px Fraunces`, `italic 400 100px Fraunces`, `500 20px Geist`, `400 20px Geist`]
    .map((f) => document.fonts?.load(f).catch(() => undefined)))
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = t.bg
  ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'alphabetic'

  // Header: label and mark, then the big number.
  ctx.fillStyle = t.muted
  ctx.font = `500 20px ${SANS}`
  spaced(ctx, `MY ${sum.year} IN BOOKS`, PAD, PAD + 22, 2.4)
  ctx.fillStyle = t.ink
  ctx.font = `400 30px ${SERIF}`
  const brandW = ctx.measureText('Folio').width
  ctx.fillText('Folio', W - PAD - brandW, PAD + 24)
  ctx.save()
  ctx.translate(W - PAD - brandW - 38, PAD - 2)
  ctx.scale(26 / 24, 26 / 24)
  ctx.strokeStyle = t.ink
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const d of MARK) ctx.stroke(new Path2D(d))
  ctx.restore()

  const numY = PAD + 220
  ctx.font = `400 200px ${SERIF}`
  const num = String(sum.books)
  ctx.fillText(num, PAD - 6, numY)
  ctx.fillStyle = t.accent
  ctx.font = `italic 400 100px ${SERIF}`
  ctx.fillText(sum.books === 1 ? 'book' : 'books', PAD + measure(ctx, num, `400 200px ${SERIF}`) + 18, numY)

  // A row of three numbers between two rules.
  const rowTop = numY + 50, rowH = 130
  ctx.fillStyle = t.line
  ctx.fillRect(PAD, rowTop, W - PAD * 2, 1)
  ctx.fillRect(PAD, rowTop + rowH, W - PAD * 2, 1)
  const colW = (W - PAD * 2) / 3
  figures(sum).forEach((f, i) => {
    const x = PAD + i * colW
    ctx.fillStyle = t.ink
    ctx.font = `400 64px ${SERIF}`
    ctx.fillText(f.value, x, rowTop + 76)
    ctx.fillStyle = t.muted
    ctx.font = `400 20px ${SANS}`
    ctx.fillText(fit(ctx, f.label, colW - 24), x, rowTop + 108)
  })

  // Footer first, so the covers know how much room they have.
  const footY = H - PAD
  const foot = footnotes(sum)
  ctx.font = `400 20px ${SANS}`
  if (foot.left) labelled(ctx, foot.left, PAD, footY, (W - PAD * 2) * 0.62, t)
  if (foot.right) {
    const width = measure(ctx, foot.right[0] + foot.right[1], `400 20px ${SANS}`)
    labelled(ctx, foot.right, W - PAD - width, footY, width + 1, t)
  }

  // Covers, as large as fit in the space left.
  const top = rowTop + rowH + 44, bottom = footY - 64
  const items = sum.items
  const gap = 14
  const size = (n: number) => { const w = (W - PAD * 2 - gap * (n - 1)) / n; return [w, w * 1.5] }
  let cols = 3
  while (cols < 12) {
    const [, h] = size(cols)
    const rows = Math.ceil(items.length / cols)
    if (rows * h + (rows - 1) * gap <= bottom - top) break
    cols++
  }
  const [cw, ch] = size(cols)
  const fitRows = Math.max(1, Math.floor((bottom - top + gap) / (ch + gap)))
  const slots = cols * fitRows
  const shown = items.length > slots ? items.slice(0, slots - 1) : items
  const imgs = await Promise.all(shown.map((it) => loadCover(it.edition?.coverUrl)))
  shown.forEach((it, i) => {
    const x = PAD + (i % cols) * (cw + gap)
    const y = top + Math.floor(i / cols) * (ch + gap)
    drawCover(ctx, it, imgs[i], x, y, cw, ch)
  })
  if (shown.length < items.length) {
    const i = shown.length
    const x = PAD + (i % cols) * (cw + gap), y = top + Math.floor(i / cols) * (ch + gap)
    ctx.fillStyle = t.line
    round(ctx, x, y, cw, ch, 6)
    ctx.fill()
    ctx.fillStyle = t.ink
    ctx.font = `400 ${Math.round(cw * 0.3)}px ${SERIF}`
    const more = `+${items.length - shown.length}`
    ctx.fillText(more, x + (cw - ctx.measureText(more).width) / 2, y + ch / 2 + cw * 0.1)
  }

  return new Promise((resolve) => {
    try { c.toBlob((b) => resolve(b), 'image/png') } catch { resolve(null) }
  })
}

function figures(sum: YearSummary): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = []
  if (sum.pages > 0) out.push({ value: fmtNumber(sum.pages), label: 'pages read' })
  const hours = Math.floor(sum.minutes / 60)
  if (hours >= 1) out.push({ value: `${hours}h`, label: 'listened' })
  const perMonth = sum.monthly.map((m) => m.books.print + m.books.ebook + m.books.audio)
  const best = perMonth.indexOf(Math.max(...perMonth))
  if (perMonth[best] >= 2) out.push({ value: monthName(best), label: `busiest month, ${plural(perMonth[best], 'book')}` })
  if (sum.avgRating) out.push({ value: sum.avgRating.toFixed(1), label: 'average rating' })
  if ((sum.topAuthors[0]?.count ?? 0) > 1) out.push({ value: String(sum.topAuthors.length), label: `authors, most of all ${sum.topAuthors[0].name}` })
  out.push({ value: String(sum.rereads), label: sum.rereads === 1 ? 'reread' : 'rereads' })
  return out.slice(0, 3)
}

function footnotes(sum: YearSummary): { left?: [string, string]; right?: [string, string] } {
  const longest = sum.longest
  const mood = moodProfile(sum.items).moods[0]?.name
  return {
    left: longest ? ['Longest: ', `${longest.work.title}, ${longest.pages} pages`] : undefined,
    right: mood ? ['Top mood: ', mood] : sum.topGenres[0] ? ['Most read: ', sum.topGenres[0].name] : undefined,
  }
}

function labelled(ctx: CanvasRenderingContext2D, [label, value]: [string, string], x: number, y: number, max: number, t: typeof THEMES.ink) {
  ctx.fillStyle = t.muted
  ctx.fillText(label, x, y)
  const lw = ctx.measureText(label).width
  ctx.fillStyle = t.ink
  ctx.fillText(fit(ctx, value, max - lw), x + lw, y)
}

function drawCover(ctx: CanvasRenderingContext2D, it: Completion, img: HTMLImageElement | null, x: number, y: number, w: number, h: number) {
  const r = Math.max(3, w * 0.05)
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 16
  ctx.shadowOffsetY = 6
  const [bg, fg, accent] = coverPalette(it.work.title + (it.work.authors[0] ?? ''))
  ctx.fillStyle = bg
  round(ctx, x, y, w, h, r)
  ctx.fill()
  ctx.restore()
  ctx.save()
  round(ctx, x, y, w, h, r)
  ctx.clip()
  if (img) {
    // Fill the frame, cropping whatever overhangs.
    const s = Math.max(w / img.naturalWidth, h / img.naturalHeight)
    const iw = img.naturalWidth * s, ih = img.naturalHeight * s
    ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih)
  } else {
    // The same typographic cover the app shows.
    const p = w * 0.11
    ctx.fillStyle = accent
    ctx.fillRect(x + p, y + p, w * 0.22, Math.max(2, w * 0.02))
    ctx.fillStyle = fg
    const size = Math.max(9, w * (it.work.title.length > 28 ? 0.11 : 0.14))
    ctx.font = `400 ${size}px ${SERIF}`
    wrap(ctx, it.work.title, w - p * 2, 5).forEach((line, i) => ctx.fillText(line, x + p, y + p * 2.2 + size * (i + 0.8) * 1.08))
    ctx.fillStyle = accent
    ctx.font = `500 ${Math.max(7, w * 0.075)}px ${SANS}`
    ctx.fillText(fit(ctx, (it.work.authors[0] ?? '').toUpperCase(), w - p * 2), x + p, y + h - p)
  }
  ctx.restore()
}

/** Loads a cover the canvas may copy from. Hosts that don't allow it (Open Library, Google Books) get the generated cover. */
function loadCover(url?: string): Promise<HTMLImageElement | null> {
  if (!url || !corsReadable(url)) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    const done = (v: HTMLImageElement | null) => { clearTimeout(timer); resolve(v) }
    const timer = setTimeout(() => done(null), 5000)
    img.crossOrigin = 'anonymous'
    img.onload = () => done(img.naturalWidth >= 8 ? img : null)
    img.onerror = () => done(null)
    img.src = url
  })
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, [r * 0.5, r, r, r * 0.5])
  else ctx.rect(x, y, w, h)
}

function measure(ctx: CanvasRenderingContext2D, text: string, font: string) {
  const prev = ctx.font
  ctx.font = font
  const w = ctx.measureText(text).width
  ctx.font = prev
  return w
}

/** Letter-spaced text, drawn a character at a time (canvas letterSpacing isn't everywhere yet). */
function spaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number) {
  for (const ch of text) {
    ctx.fillText(ch, x, y)
    x += ctx.measureText(ch).width + spacing
  }
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text
  let s = text
  while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1)
  return s.trimEnd() + '…'
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, maxLines: number) {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width <= max || !line) line = next
    else { lines.push(line); line = word }
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    kept[maxLines - 1] = fit(ctx, kept[maxLines - 1] + '…', max)
    return kept
  }
  return lines.map((l) => fit(ctx, l, max))
}
