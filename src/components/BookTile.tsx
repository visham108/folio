import { motion } from 'framer-motion'
import { Heart, RotateCcw } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Entry } from '../lib/types'
import { useStore } from '../state/store'
import { Cover } from './Cover'
import { Stars } from './ui'

export function BookTile({ entry, index = 0, meta }: { entry: Entry; index?: number; meta?: React.ReactNode }) {
  const { works, editionOf, readsByEntry } = useStore()
  const work = works.get(entry.workId)
  if (!work) return null
  const ed = editionOf(entry)
  const times = (readsByEntry.get(entry.id) ?? []).filter((r) => r.state === 'finished').length
  return (
    <motion.div
      className="tile"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 18) * 0.025, type: 'spring', stiffness: 260, damping: 26 }}
    >
      <Link to={`/book/${work.id}`} className="tile-link">
        <Cover work={work} edition={ed} size="md" />
        <div className="tile-meta">
          <div className="tile-title">{work.title}</div>
          <div className="tile-author">{work.authors.join(', ')}</div>
          <div className="tile-row">
            {entry.rating ? <Stars value={entry.rating} size={12} /> : null}
            {times > 1 && <span className="pill tiny" title={`Read ${times} times`}><RotateCcw size={10} />×{times}</span>}
            {entry.favorite && <Heart size={12} className="fav" fill="currentColor" />}
          </div>
          {meta}
        </div>
      </Link>
    </motion.div>
  )
}
