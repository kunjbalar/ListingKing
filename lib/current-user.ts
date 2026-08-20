import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function currentUser() {
  const session = await auth();
  if (!session?.user?.email) return null;
  return prisma.user.findUnique({ where: { email: session.user.email } });
}
