import { ThreadRoute, threadMetadata, threadParams } from '@/lib/server/thread-route'

export const dynamicParams = false
export const generateStaticParams = () => threadParams(false)
export const generateMetadata = ({ params }: { params: { id: string } }) => threadMetadata(params.id)
export default function Page({ params }: { params: { id: string } }) {
  return <ThreadRoute id={params.id} />
}
