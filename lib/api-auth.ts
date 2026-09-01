import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { auth } from "./auth";
import { prisma } from "./prisma";

const b64 = (input: Buffer | string) => Buffer.from(input).toString("base64url");
const sign = (input: string) => b64(crypto.createHmac("sha256", process.env.AUTH_SECRET || "development-only-change-me").update(input).digest());

export function createExtensionToken(userId: string) {
  const payload = b64(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 60 * 60, scope: "extension" }));
  return `${payload}.${sign(payload)}`;
}

export async function requireApiUser(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (bearer) {
    const [payload, signature] = bearer.split(".");
    const expected = sign(payload);
    if (!payload || !signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    try { const decoded = JSON.parse(Buffer.from(payload, "base64url").toString()); if (decoded.scope !== "extension" || decoded.exp * 1000 < Date.now()) return null; return prisma.user.findUnique({ where: { id: decoded.sub } }); } catch { return null; }
  }
  const session = await auth(); return session?.user?.email ? prisma.user.findUnique({ where: { email: session.user.email } }) : null;
}

export async function authenticateExtension(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user?.passwordHash || !await bcrypt.compare(password, user.passwordHash)) return null;
  return { user, token: createExtensionToken(user.id) };
}
