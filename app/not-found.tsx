export default function NotFound() {
  return (
    <main className="flex-1 flex items-center justify-center px-6">
      <div className="text-center fade-up">
        <p className="text-sm uppercase tracking-widest text-[#93a1bd]">404</p>
        <h1 className="text-3xl font-bold mt-2">Page not found</h1>
        <p className="text-[#93a1bd] mt-2">That page is gone — or never was.</p>
        <a href="/" className="mt-6 inline-block rounded-lg bg-[#008CE7] px-4 py-2 font-medium text-white hover:bg-[#006bb3] transition">
          Back to home
        </a>
      </div>
    </main>
  )
}
