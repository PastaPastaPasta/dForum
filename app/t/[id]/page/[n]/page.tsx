import { ThreadRoute, threadMetadata, threadParams } from '@/lib/server/thread-route'

export const dynamicParams = false
export const generateStaticParams = () => threadParams(true)
export const generateMetadata = ({ params }: { params: { id: string; n: string } }) => threadMetadata(params.id, Number(params.n))
export default function Page({ params }: { params: { id: string; n: string } }) {
  return <ThreadRoute id={params.id} n={Number(params.n)} />
}
