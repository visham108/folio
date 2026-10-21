/** The build this copy of the app came from (set at build time; missing on the dev server). */
export const BUILD_ID = import.meta.env.VITE_BUILD_ID as string | undefined

/** The build now live on the site, or undefined when that can't be told (offline, dev server). */
export async function liveBuild(): Promise<string | undefined> {
  if (!BUILD_ID || !import.meta.env.PROD) return undefined
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return undefined
    const { id } = (await res.json()) as { id?: unknown }
    return typeof id === 'string' ? id : undefined
  } catch {
    return undefined
  }
}

const CHECK = 'folio:check-update'
/** Ask the update notice to check now (the Refresh button does). */
export const checkForUpdate = () => window.dispatchEvent(new Event(CHECK))
export const onCheckForUpdate = (fn: () => void) => {
  window.addEventListener(CHECK, fn)
  return () => window.removeEventListener(CHECK, fn)
}
