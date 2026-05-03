import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground">
      <main className="flex flex-col items-center text-center gap-8 max-w-2xl px-4">
        <h1 className="text-5xl font-extrabold tracking-tight">
          Welcome to Content Engagement Platform
        </h1>
        <p className="text-xl text-muted-foreground">
          Curate "content tracks" (videos, PDFs, articles) into binge-able streams and capture granular engagement events.
        </p>
        <div className="flex gap-4">
          <Link href="/login">
            <Button size="lg" variant="outline">Log in</Button>
          </Link>
          <Link href="/signup">
            <Button size="lg">Sign up</Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
