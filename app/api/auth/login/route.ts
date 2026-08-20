import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8)
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const credentials = credentialsSchema.safeParse(body);

  if (!credentials.success) {
    return Response.json({ code: "VALIDATION_ERROR", message: "Enter a valid email and password." }, { status: 400 });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email: credentials.data.email } });
    const passwordHash = user?.passwordHash;
    const isValid = typeof passwordHash === "string" && await bcrypt.compare(credentials.data.password, passwordHash);

    if (!isValid) {
      return Response.json({ code: "INVALID_CREDENTIALS", message: "Incorrect email or password." }, { status: 401 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Credential check failed.", error);
    return Response.json(
      { code: "DATABASE_UNAVAILABLE", message: "ListingKing cannot reach its database. Check your database connection and try again." },
      { status: 503 }
    );
  }
}
