'use client'

import { useEffect, useRef, useState } from 'react'
import { ImageOff } from 'lucide-react'

/** Remote images in posts. When the host refuses to serve the image here (imported archive
 * attachments often do), the post shows a link to it instead of a broken image. */
export function PostImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  const img = useRef<HTMLImageElement>(null)
  // The image may have failed before hydration attached onError.
  useEffect(() => { const el = img.current; if (el?.complete && el.naturalWidth === 0) setFailed(true) }, [])
  if (failed) {
    return (
      <a href={src} rel="nofollow ugc noopener noreferrer" target="_blank" className="inline-flex items-center gap-1.5">
        <ImageOff aria-hidden className="h-4 w-4" />{alt || 'Image'} (open the original)
      </a>
    )
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={img} src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}
