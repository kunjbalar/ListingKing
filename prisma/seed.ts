import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";

async function main() {
  const user = await prisma.user.upsert({ where: { email: "demo@listingking.app" }, update: {}, create: { email: "demo@listingking.app", passwordHash: await bcrypt.hash("DemoPass123!", 12) } });
  const template = await prisma.template.upsert({ where: { id: "demo-template" }, update: {}, create: { id: "demo-template", userId: user.id, name: "Men's shirt essentials", categoryLabel: "Shirt Fabric", schemaJson: { fields: [] } } });
  console.log(`Seeded ${user.email} and ${template.name}`);
}
main().finally(() => prisma.$disconnect());
