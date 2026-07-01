import { createFileRoute } from "@tanstack/react-router";
import { Game } from "@/components/eggscape/Game";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <main className="h-full w-full bg-gradient-to-b from-amber-100 via-orange-100 to-amber-200">
      <Game />
    </main>
  );
}
