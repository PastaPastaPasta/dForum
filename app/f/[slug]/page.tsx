import { ForumRoute, forumMetadata, forumParams } from '@/lib/server/forum-route'

export const dynamicParams = false
export const generateStaticParams = () => forumParams(false)
export const generateMetadata = ({ params }: { params: { slug: string } }) => forumMetadata(params.slug)
export default function Page({ params }: { params: { slug: string } }) {
  return <ForumRoute slug={params.slug} />
}
