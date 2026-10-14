import { AnimatePresence, motion } from 'framer-motion'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

interface Toast { id: number; text: string; tone: 'info' | 'error'; action?: { label: string; run: () => void } }
type Push = (text: string, opts?: { tone?: Toast['tone']; action?: Toast['action'] }) => void

const Ctx = createContext<Push>(() => {})
export const useToast = () => useContext(Ctx)

let n = 0
export function ToastProvider({ children }: { children: (push: Push) => ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback<Push>((text, opts = {}) => {
    const id = ++n
    setItems((xs) => [...xs.slice(-2), { id, text, tone: opts.tone ?? 'info', action: opts.action }])
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), opts.tone === 'error' ? 7000 : 4200)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children(push)}
      <div className="toasts" role="status" aria-live="polite">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              className={`toast ${t.tone}`}
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
              <span>{t.text}</span>
              {t.action && (
                <button className="toast-action" onClick={() => { t.action!.run(); setItems((xs) => xs.filter((x) => x.id !== t.id)) }}>
                  {t.action.label}
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  )
}
