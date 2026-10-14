/**
 * Cover photo studio: perspective-correct crop + automatic clean-up.
 * Everything runs in the browser on a canvas; the optional AI step
 * (analyze-cover edge function) only supplies better corner positions.
 */

export type Pt = [number, number]

export async function fileToCanvas(file: Blob, maxSide = 1600): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close?.()
  return c
}

/**
 * Finds the book by separating it from the background: the border of a photo
 * is almost always background, so anything far (in colour) from the border's
 * average colour is "book". Returns normalised corners TL, TR, BR, BL.
 */
export function detectCorners(src: HTMLCanvasElement): Pt[] {
  const W = 160
  const H = Math.max(1, Math.round((src.height / src.width) * W))
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0, W, H)
  const d = ctx.getImageData(0, 0, W, H).data
  const px = (x: number, y: number) => {
    const i = (y * W + x) * 4
    return [d[i], d[i + 1], d[i + 2]]
  }
  let br = 0, bg = 0, bb = 0, n = 0
  const b = 3
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x >= b && x < W - b && y >= b && y < H - b) continue
    const [r, g, bl] = px(x, y)
    br += r; bg += g; bb += bl; n++
  }
  br /= n; bg /= n; bb /= n
  const mask = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, bl] = px(x, y)
    const dist = Math.hypot(r - br, g - bg, bl - bb)
    mask[y * W + x] = dist > 42 ? 1 : 0
  }
  const rowFrac = (y: number) => { let s = 0; for (let x = 0; x < W; x++) s += mask[y * W + x]; return s / W }
  const colFrac = (x: number) => { let s = 0; for (let y = 0; y < H; y++) s += mask[y * W + x]; return s / H }
  const t = 0.3
  let top = 0, bottom = H - 1, left = 0, right = W - 1
  while (top < H - 1 && rowFrac(top) < t) top++
  while (bottom > top && rowFrac(bottom) < t) bottom--
  while (left < W - 1 && colFrac(left) < t) left++
  while (right > left && colFrac(right) < t) right--
  // Nothing convincing found → default to a generous centred frame.
  if ((right - left) / W < 0.25 || (bottom - top) / H < 0.25) {
    return [[0.08, 0.06], [0.92, 0.06], [0.92, 0.94], [0.08, 0.94]]
  }
  const l = left / W, r = (right + 1) / W, tp = top / H, bt = (bottom + 1) / H
  return [[l, tp], [r, tp], [r, bt], [l, bt]]
}

/** Solves the 3×3 homography mapping `from` quad onto `to` quad. */
function homography(from: Pt[], to: Pt[]): number[] {
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i]
    const [u, v] = to[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  // Gaussian elimination with partial pivoting on the 8×9 augmented matrix.
  for (let col = 0; col < 8; col++) {
    let piv = col
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
    ;[A[col], A[piv]] = [A[piv], A[col]]
    for (let r = 0; r < 8; r++) {
      if (r === col) continue
      const f = A[r][col] / A[col][col]
      for (let k = col; k < 9; k++) A[r][k] -= f * A[col][k]
    }
  }
  const h = A.map((row, i) => row[8] / row[i])
  return [...h, 1]
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Perspective-warps the quad (normalised corners) into a flat rectangle. */
export function warp(src: HTMLCanvasElement, cornersN: Pt[], maxH = 1200): HTMLCanvasElement {
  const q = cornersN.map(([x, y]) => [x * src.width, y * src.height] as Pt)
  const wPx = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2
  const hPx = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2
  const scale = Math.min(1, maxH / hPx)
  const W = Math.max(1, Math.round(wPx * scale))
  const H = Math.max(1, Math.round(hPx * scale))
  const rect: Pt[] = [[0, 0], [W, 0], [W, H], [0, H]]
  const m = homography(rect, q) // output pixel → source pixel

  const sctx = src.getContext('2d', { willReadFrequently: true })!
  const sd = sctx.getImageData(0, 0, src.width, src.height)
  const out = document.createElement('canvas')
  out.width = W
  out.height = H
  const octx = out.getContext('2d')!
  const od = octx.createImageData(W, H)
  const sw = src.width, sh = src.height, S = sd.data, O = od.data
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const den = m[6] * x + m[7] * y + m[8]
      const fx = (m[0] * x + m[1] * y + m[2]) / den
      const fy = (m[3] * x + m[4] * y + m[5]) / den
      const x0 = Math.max(0, Math.min(sw - 2, Math.floor(fx)))
      const y0 = Math.max(0, Math.min(sh - 2, Math.floor(fy)))
      const ax = Math.max(0, Math.min(1, fx - x0)), ay = Math.max(0, Math.min(1, fy - y0))
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4
      const o = (y * W + x) * 4
      for (let ch = 0; ch < 3; ch++) {
        const top = S[i00 + ch] + (S[i10 + ch] - S[i00 + ch]) * ax
        const bot = S[i01 + ch] + (S[i11 + ch] - S[i01 + ch]) * ax
        O[o + ch] = top + (bot - top) * ay
      }
      O[o + 3] = 255
    }
  }
  octx.putImageData(od, 0, 0)
  return out
}

/**
 * Auto clean-up: per-channel levels (fixes colour casts from indoor light and
 * lifts dull phone photos), a touch of vibrance, and a gentle unsharp mask.
 */
export function enhance(src: HTMLCanvasElement, strength = 1): HTMLCanvasElement {
  const W = src.width, H = src.height
  const out = document.createElement('canvas')
  out.width = W
  out.height = H
  const ctx = out.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0)
  const img = ctx.getImageData(0, 0, W, H)
  const d = img.data
  const N = W * H

  const lo = [0, 0, 0], hi = [255, 255, 255]
  for (let ch = 0; ch < 3; ch++) {
    const hist = new Uint32Array(256)
    for (let i = ch; i < d.length; i += 4) hist[d[i]]++
    let acc = 0
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > N * 0.006) { lo[ch] = v; break } }
    acc = 0
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > N * 0.006) { hi[ch] = v; break } }
    // Don't over-stretch already-flat or deliberately muted covers.
    if (hi[ch] - lo[ch] < 60) { lo[ch] = 0; hi[ch] = 255 }
  }
  const lut = [0, 1, 2].map((ch) => {
    const t = new Uint8ClampedArray(256)
    for (let v = 0; v < 256; v++) {
      const stretched = ((v - lo[ch]) / Math.max(1, hi[ch] - lo[ch])) * 255
      t[v] = v + (stretched - v) * strength
    }
    return t
  })
  const sat = 1 + 0.08 * strength
  for (let i = 0; i < d.length; i += 4) {
    const r = lut[0][d[i]], g = lut[1][d[i + 1]], b = lut[2][d[i + 2]]
    const l = 0.299 * r + 0.587 * g + 0.114 * b
    d[i] = l + (r - l) * sat
    d[i + 1] = l + (g - l) * sat
    d[i + 2] = l + (b - l) * sat
  }
  // Unsharp mask (3×3 box blur).
  const amount = 0.45 * strength
  if (amount > 0) {
    const copy = new Uint8ClampedArray(d)
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = (y * W + x) * 4
        for (let ch = 0; ch < 3; ch++) {
          let s = 0
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += copy[i + (dy * W + dx) * 4 + ch]
          d[i + ch] = copy[i + ch] + (copy[i + ch] - s / 9) * amount
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0)
  return out
}

export function canvasToBlob(c: HTMLCanvasElement, quality = 0.86): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality),
  )
}

export function canvasToBase64(c: HTMLCanvasElement, maxSide = 1024): string {
  const s = Math.min(1, maxSide / Math.max(c.width, c.height))
  const t = document.createElement('canvas')
  t.width = Math.round(c.width * s)
  t.height = Math.round(c.height * s)
  t.getContext('2d')!.drawImage(c, 0, 0, t.width, t.height)
  return t.toDataURL('image/jpeg', 0.82).split(',')[1]
}

/** Average colour of an image, for ambient backgrounds. Null when the image is cross-origin-tainted. */
export function averageColor(img: HTMLImageElement): [number, number, number] | null {
  try {
    const c = document.createElement('canvas')
    c.width = 24
    c.height = 36
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(img, 0, 0, 24, 36)
    const d = ctx.getImageData(0, 0, 24, 36).data
    let r = 0, g = 0, b = 0, n = 0
    for (let i = 0; i < d.length; i += 4) {
      const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2])
      const w = 0.25 + (max - min) / 255 // favour saturated pixels
      r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; n += w
    }
    return [r / n, g / n, b / n].map(Math.round) as [number, number, number]
  } catch {
    return null
  }
}
