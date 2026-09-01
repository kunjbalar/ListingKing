import { z } from "zod";
import { authenticateExtension } from "@/lib/api-auth";

export async function POST(request: Request) {
  const data = z.object({ email: z.string().email(), password: z.string().min(8) }).safeParse(await request.json());
  if (!data.success) return Response.json({ code: "VALIDATION_ERROR" }, { status: 400 });
  const account = await authenticateExtension(data.data.email, data.data.password);
  if (!account) return Response.json({ code: "INVALID_CREDENTIALS", message: "Could not sign in." }, { status: 401 });
  return Response.json({ accessToken: account.token, expiresIn: 3600, user: { email: account.user.email } });
}
