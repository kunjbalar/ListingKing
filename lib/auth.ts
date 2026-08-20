import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Credentials({
    credentials: { email: {}, password: {} },
    async authorize(raw) {
      const credentials = z.object({ email: z.string().email(), password: z.string().min(8) }).safeParse(raw);
      if (!credentials.success) return null;
      const user = await prisma.user.findUnique({ where: { email: credentials.data.email.toLowerCase() } });
      if (!user?.passwordHash || !await bcrypt.compare(credentials.data.password, user.passwordHash)) return null;
      return { id: user.id, email: user.email };
    }
  })],
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in" }
});
