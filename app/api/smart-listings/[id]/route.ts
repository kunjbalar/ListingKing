import { z } from "zod";
import { currentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { generateProductSku } from "@/lib/sku";

const itemSchema = z.object({ id: z.string(), title: z.string().trim().min(2).max(100), description: z.string().trim().min(3).max(1500), mrp: z.coerce.number().positive(), meeshoPrice: z.coerce.number().positive(), defectivePrice: z.preprocess(value => value === "" || value === null || value === undefined ? undefined : value, z.coerce.number().positive().optional()), inventory: z.coerce.number().int().positive().max(100000) }).superRefine((item, context) => {
  if (item.meeshoPrice > item.mrp) context.addIssue({ code: "custom", path: ["meeshoPrice"], message: "Selling price cannot exceed MRP." });
  if (item.defectivePrice !== undefined && item.defectivePrice > item.meeshoPrice) context.addIssue({ code: "custom", path: ["defectivePrice"], message: "Return price cannot exceed selling price." });
});

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ code: "UNAUTHORIZED", message: "Sign in to view this Smart Listing." }, { status: 401 });
  const { id } = await params;
  const listing = await prisma.smartListing.findFirst({
    where: { id, userId: user.id },
    include: {
      template: { select: { name: true, version: true } },
      items: {
        orderBy: { position: "asc" },
        include: { images: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });
  if (!listing) return Response.json({ code: "NOT_FOUND", message: "Smart Listing not found." }, { status: 404 });
  return Response.json(listing);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ code: "UNAUTHORIZED", message: "Sign in to update this Smart Listing." }, { status: 401 });
    const { id } = await params;
    const data = z.object({ items: z.array(itemSchema).min(1) }).safeParse(await request.json().catch(() => null));
    if (!data.success) return Response.json({ code: "VALIDATION_ERROR", message: "Every title, description, MRP, Meesho price, and inventory value is required. Wrong / defective return price is optional.", fieldErrors: data.error.flatten() }, { status: 400 });
    const listing = await prisma.smartListing.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!listing) return Response.json({ code: "NOT_FOUND", message: "Smart Listing not found." }, { status: 404 });
    const itemIds = data.data.items.map(item => item.id);
    const ownedItems = await prisma.smartListingItem.findMany({ where: { smartListingId: id, id: { in: itemIds } }, select: { id: true, position: true } });
    if (ownedItems.length !== itemIds.length) return Response.json({ code: "FORBIDDEN", message: "One or more listing items do not belong to this draft." }, { status: 403 });
    const positionById = new Map(ownedItems.map(item => [item.id, item.position]));

    // The Neon HTTPS adapter has no transaction endpoint. Ownership and every
    // value are validated before any write, then each item is saved directly.
    for (const item of data.data.items) {
      await prisma.smartListingItem.update({ where: { id: item.id }, data: {
        title: item.title,
        description: item.description,
        mrp: item.mrp,
        meeshoPrice: item.meeshoPrice,
        defectivePrice: item.defectivePrice ?? null,
        validationJson: { inventory: item.inventory },
        sku: generateProductSku(item.title, id, item.id, positionById.get(item.id)!),
      } });
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Smart Listing content update failed.", error);
    return Response.json({ code: "CONTENT_UPDATE_FAILED", message: "ListingKing could not save content and prices. Please try again." }, { status: 503 });
  }
}
