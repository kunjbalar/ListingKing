import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const data = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(8) }).safeParse(body);
  if (!data.success) return Response.json({ code: "VALIDATION_ERROR", message: "Email and an 8+ character password are required." }, { status: 400 });

  try {
    const user = await prisma.user.create({ data: { email: data.data.email, passwordHash: await bcrypt.hash(data.data.password, 12) } });
    return Response.json({ id: user.id, email: user.email }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ code: "EMAIL_TAKEN", message: "An account with this email already exists. Please sign in instead." }, { status: 409 });
    }

    console.error("Account registration failed.", error);
    return Response.json(
      { code: "REGISTRATION_UNAVAILABLE", message: "We could not create your account right now. Please try again shortly." },
      { status: 503 }
    );
  }
}
