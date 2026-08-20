import { requireApiUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const user = await requireApiUser(request); if (!user) return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  const listings = await prisma.smartListing.findMany({
    where: { userId: user.id, status: { in: ["READY", "PARTIALLY_FILLED"] } },
    select: {
      id: true,
      name: true,
      listingCount: true,
      productDetailsJson: true,
      template: { select: { id: true, name: true, version: true, schemaJson: true, status: true } },
      items: {
        where: { status: { not: "FILLED" } },
        orderBy: { position: "asc" },
        select: { id: true, position: true, status: true, title: true, description: true, sku: true, mrp: true, meeshoPrice: true, defectivePrice: true, validationJson: true, images: { select: { id: true, role: true } } },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
  return Response.json(listings);
}
