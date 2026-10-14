import { Loader2, RotateCw, Sparkles, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { canvasToBlob, detectCorners, enhance, fileToCanvas, warp, type Pt } from '../lib/image'
import { useStore } from '../state/store'
import { useToast } from '../state/toast'
import { Sheet } from './ui'

/**
 * Turn a phone snap of a book into a clean, flat cover:
 *  1. find the book against its background (on-device)
 *  2. let the user nudge the four corners
 *  3. perspective-correct + auto colour/contrast/sharpen
 */
export function CoverStudio({ file, onClose, onDone }: {
  file: File | null
  onClose: () => void
  onDone: (url: string) => void
}) {
  const { backend } = useStore()
  const toast = useToast()
  const [src, setSrc] = useState<HTMLCanvasElement | null>(null)
  const [corners, setCorners] = useState<Pt[]>([])
  const [doEnhance, setDoEnhance] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<string>()
  const stage = useRef<HTMLDivElement>(null)
  const drag = useRef<number | null>(null)

  useEffect(() => {
    if (!file) return
    let live = true
    setBusy('Reading photo…')
    fileToCanvas(file)
      .then((c) => {
        if (!live) return
        setSrc(c)
        setCorners(detectCorners(c))
        setBusy(null)
      })
      .catch(() => { toast('Couldn’t open that image', { tone: 'error' }); onClose() })
    return () => { live = false }
  }, [file]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live preview of the result.
  useEffect(() => {
    if (!src || corners.length !== 4) return
    const t = setTimeout(() => {
      let out = warp(src, corners, 700)
      if (doEnhance) out = enhance(out)
      setPreview(out.toDataURL('image/jpeg', 0.8))
    }, 120)
    return () => clearTimeout(t)
  }, [src, corners, doEnhance])

  const rotate = () => {
    if (!src) return
    const c = document.createElement('canvas')
    c.width = src.height
    c.height = src.width
    const ctx = c.getContext('2d')!
    ctx.translate(c.width, 0)
    ctx.rotate(Math.PI / 2)
    ctx.drawImage(src, 0, 0)
    setSrc(c)
    setCorners(detectCorners(c))
  }

  const onMove = (e: React.PointerEvent) => {
    if (drag.current == null || !stage.current) return
    const r = stage.current.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    setCorners((cs) => cs.map((p, i) => (i === drag.current ? [x, y] : p)))
  }

  const save = async () => {
    if (!src || !backend) return
    setBusy('Saving…')
    try {
      let out = warp(src, corners, 1200)
      if (doEnhance) out = enhance(out)
      const url = await backend.uploadCover(await canvasToBlob(out))
      onDone(url)
    } catch (e) {
      toast('Upload failed: ' + (e as Error).message, { tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const srcUrl = useMemo(() => src?.toDataURL('image/jpeg', 0.8), [src])
  const poly = corners.map(([x, y]) => `${x * 100},${y * 100}`).join(' ')
  return (
    <Sheet open={!!file} onClose={onClose} title="Tidy up the cover" wide footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={!src || !!busy}>Use this cover</button>
      </>
    }>
      <div className="studio">
        <div className="studio-stage-wrap">
          {src ? (
            <div
              className="studio-stage"
              ref={stage}
              style={{ aspectRatio: `${src.width} / ${src.height}` }}
              onPointerMove={onMove}
              onPointerUp={() => (drag.current = null)}
              onPointerLeave={() => (drag.current = null)}
            >
              <img src={srcUrl} alt="Your photo" draggable={false} />
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="studio-overlay">
                <defs>
                  <mask id="studio-mask">
                    <rect width="100" height="100" fill="white" />
                    <polygon points={poly} fill="black" />
                  </mask>
                </defs>
                <rect width="100" height="100" className="studio-dim" mask="url(#studio-mask)" />
                <polygon points={poly} className="studio-quad" vectorEffect="non-scaling-stroke" />
              </svg>
              {corners.map(([x, y], i) => (
                <button
                  key={i}
                  className="studio-handle"
                  style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
                  aria-label={['Top left', 'Top right', 'Bottom right', 'Bottom left'][i] + ' corner'}
                  onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = i }}
                  onPointerMove={onMove}
                  onPointerUp={() => (drag.current = null)}
                />
              ))}
            </div>
          ) : (
            <div className="studio-loading"><Loader2 className="spin" /> {busy}</div>
          )}
          <div className="studio-tools">
            <button className="btn btn-ghost sm" onClick={() => src && setCorners(detectCorners(src))}><Wand2 size={14} /> Auto-detect</button>
            <button className="btn btn-ghost sm" onClick={rotate}><RotateCw size={14} /> Rotate</button>
            <label className="check sm"><input type="checkbox" checked={doEnhance} onChange={(e) => setDoEnhance(e.target.checked)} /> <Sparkles size={14} /> Enhance</label>
          </div>
        </div>
        <div className="studio-preview">
          <span className="kicker">Result</span>
          {preview ? <img src={preview} alt="Cropped cover preview" /> : <div className="studio-ph" />}
          {busy && src && <p className="muted small"><Loader2 size={12} className="spin" /> {busy}</p>}
          <p className="muted tiny">Drag the corners to the edges of the cover. We straighten it, fix the lighting and sharpen it.</p>
        </div>
      </div>
    </Sheet>
  )
}
