'use client'

import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

/** Shown while the browser is offline: pages still read from the static index, but new activity
 * and posting need a connection. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  if (!offline) return null
  return (
    <div role="status" className="border-b border-rule bg-archive-wash px-4 py-2 text-center text-sm text-archive">
      <WifiOff aria-hidden className="mr-1.5 inline h-4 w-4 align-[-3px]" />
      You&apos;re offline. You can keep reading, but new posts won&apos;t load and you can&apos;t post until you reconnect.
    </div>
  )
}
