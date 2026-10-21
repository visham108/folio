import { Headphones } from 'lucide-react'
import { useState } from 'react'
import type { Edition, Work } from '../lib/types'
import { coverPalette } from '../lib/util'

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

/** Covers in our own storage allow CORS, so their pixels can be read (ambient colour, the year card). Other hosts refuse. */
export const corsReadable = (url: string) => url.includes('/storage/v1/object/public/')

/**
 * Book cover. Falls back to a generated typographic cover so books without
 * artwork still look intentional rather than broken.
 */
export function Cover({
  work, edition, size = 'md', badge = true, className = '', onLoadImg,
}: {
  work: Pick<Work, 'title' | 'authors'>
  edition?: Pick<Edition, 'coverUrl' | 'format'>
  size?: Size
  badge?: boolean
  className?: string
  onLoadImg?: (img: HTMLImageElement) => void
}) {
  const [failed, setFailed] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<string | null>(null)
  const url = edition?.coverUrl
  const showImg = url && failed !== url
  const audio = edition?.format === 'audiobook'
  return (
    <div className={`cover cover-${size} ${audio ? 'is-audio' : ''} ${className}`}>
      {/* The typographic cover sits underneath until the artwork arrives. */}
      {(!showImg || loaded !== url) && <GeneratedCover title={work.title} author={work.authors[0] ?? ''} />}
      {showImg && (
        <img
          className={loaded === url ? 'in' : ''}
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          // Dragging a book drags its tile, not the picture: Chrome cancels the drag of an image
          // that hasn't finished loading, so a slow cover would otherwise break dropping onto a pile.
          draggable={false}
          // Only request CORS where the host supports it (our own storage), so the
          // ambient-colour sampler can read pixels; other hosts would refuse the image.
          crossOrigin={corsReadable(url) ? 'anonymous' : undefined}
          onLoad={(e) => {
            const img = e.currentTarget
            // Open Library returns a 1×1 gif for unknown ISBNs.
            if (img.naturalWidth < 8) setFailed(url)
            else {
              setLoaded(url)
              onLoadImg?.(img)
            }
          }}
          onError={() => setFailed(url)}
        />
      )}
      <span className="cover-sheen" aria-hidden />
      {badge && audio && (
        <span className="cover-badge" title="Audiobook">
          <Headphones size={12} strokeWidth={2.4} />
        </span>
      )}
    </div>
  )
}

function GeneratedCover({ title, author }: { title: string; author: string }) {
  const [bg, fg, accent] = coverPalette(title + author)
  const long = title.length > 28
  return (
    <div className="gen-cover" style={{ background: bg, color: fg }}>
      <span className="gen-rule" style={{ background: accent }} />
      <span className={`gen-title ${long ? 'long' : ''}`}>{title}</span>
      <span className="gen-author" style={{ color: accent }}>{author}</span>
    </div>
  )
}
