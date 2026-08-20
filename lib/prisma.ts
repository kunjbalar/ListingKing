import { PrismaNeonHTTP } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to connect ListingKing to Neon.");

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
// Neon HTTP uses HTTPS rather than a raw PostgreSQL TCP connection. This keeps
// the existing Neon database available on networks that block port 5432.
const adapter = new PrismaNeonHTTP(connectionString, {});
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
