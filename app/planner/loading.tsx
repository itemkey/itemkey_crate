export default function PlannerLoading() {
  return (
    <main className="min-h-screen bg-[#f5f6f8] p-5" aria-busy="true">
      <div className="mx-auto h-[calc(100vh-2.5rem)] max-w-[1600px] animate-pulse rounded-3xl bg-white" />
    </main>
  );
}
