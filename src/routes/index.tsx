import { createFileRoute } from "@tanstack/react-router";
import { Game } from "@/components/eggscape/Game";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-amber-100 via-orange-100 to-amber-200 py-6 px-4">
      <header className="max-w-[1280px] mx-auto mb-5 text-center">
        <h1 className="text-5xl sm:text-6xl font-black text-amber-900 tracking-tight drop-shadow-sm">
          The Great Eggscape
        </h1>
        <p className="text-amber-800 mt-1 text-lg italic">
          One egg. One shot. Don't get scrambled.
        </p>
      </header>
      <Game />
    </main>
  );
}
