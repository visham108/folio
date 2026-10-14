import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cleanIsbn } from '../lib/util'
import { Sheet } from './ui'

/**
 * ISBN barcode scanner. Uses the native BarcodeDetector where available
 * (Chrome/Android), otherwise lazy-loads ZXing (iOS Safari, Firefox).
 */
export function Scanner({ open, onClose, onIsbn }: { open: boolean; onClose: () => void; onIsbn: (isbn: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [err, setErr] = useState<string | null>(null)
  const [starting, setStarting] = useState(true)

  useEffect(() => {
    if (!open) return
    let stop = () => {}
    let done = false
    setErr(null)
    setStarting(true)
    const found = (raw: string) => {
      const isbn = cleanIsbn(raw)
      if (!isbn || done) return
      done = true
      navigator.vibrate?.(30)
      onIsbn(isbn)
    }
    ;(async () => {
      try {
        const v = video.current!
        const BD = (window as unknown as { BarcodeDetector?: new (o: object) => { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> } }).BarcodeDetector
        if (BD) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
          v.srcObject = stream
          await v.play()
          setStarting(false)
          const det = new BD({ formats: ['ean_13', 'ean_8', 'upc_a'] })
          let raf = 0
          const tick = async () => {
            if (done) return
            try {
              const codes = await det.detect(v)
              if (codes[0]) found(codes[0].rawValue)
            } catch { /* frame not ready */ }
            raf = requestAnimationFrame(tick)
          }
          tick()
          stop = () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()) }
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser')
          const reader = new BrowserMultiFormatReader()
          const controls = await reader.decodeFromVideoDevice(undefined, v, (res) => res && found(res.getText()))
          setStarting(false)
          stop = () => controls.stop()
        }
      } catch (e) {
        setErr((e as Error).name === 'NotAllowedError' ? 'Camera permission was denied.' : 'Couldn’t start the camera on this device.')
        setStarting(false)
      }
    })()
    return () => { done = true; stop() }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet open={open} onClose={onClose} title="Scan the barcode">
      <div className="scanner">
        <video ref={video} playsInline muted />
        <div className="scanner-frame" aria-hidden />
        {starting && !err && <div className="scanner-msg"><Loader2 className="spin" /> Starting camera…</div>}
        {err && <div className="scanner-msg">{err}</div>}
      </div>
      <p className="muted small center">Point at the barcode on the back cover (the one starting 978 or 979).</p>
    </Sheet>
  )
}
