import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { InstallPrompt } from "@/components/install-prompt";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <Link href="/app" className="font-semibold">Meal Plan</Link>
        <nav className="flex items-center gap-4">
          <Link href="/app/meals" className="text-sm">Recipes</Link>
          <Link href="/app/settings/profiles" className="text-sm">Profiles</Link>
          <UserButton />
        </nav>
      </header>
      <main className="px-4 py-6">{children}</main>
      <InstallPrompt />
    </div>
  );
}
