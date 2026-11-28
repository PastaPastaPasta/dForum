import Link from 'next/link'

/** A member link, or the imported author's name (not a link to a live identity). */
export function AuthorLink({ id, name, archiveAuthor, className = '' }: { id: string; name: string; archiveAuthor?: string; className?: string }) {
  if (archiveAuthor) {
    return <span className={`text-archive ${className}`} title="Imported author (not a Dash identity)">{archiveAuthor}</span>
  }
  return <Link href={`/u/${id}/`} className={`font-medium hover:text-dash ${className}`}>{name}</Link>
}
