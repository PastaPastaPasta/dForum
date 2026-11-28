import { ForumRoute, forumMetadata, forumParams } from '@/lib/server/forum-route'

export const dynamicParams = false
export const generateStaticParams = () => forumParams(true)
export const generateMetadata = ({ params }: { params: { slug: string; n: string } }) => forumMetadata(params.slug, Number(params.n))
export default function Page({ params }: { params: { slug: string; n: string } }) {
  return <ForumRoute slug={params.slug} n={Number(params.n)} />
}
