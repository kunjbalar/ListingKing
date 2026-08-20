import crypto from "node:crypto";
import { z } from "zod";
import { currentUser } from "@/lib/current-user";
import { productDetailsSchema } from "@/lib/contracts";
import { prisma } from "@/lib/prisma";
import { generateProductSku } from "@/lib/sku";

const bodySchema = z.object({ listingCount: z.coerce.number().int().min(1).max(50) });

/**
 * Keeps the saved draft's item rows in sync when a seller changes the count
 * after returning to Setup. Images are paired by item position, so positions
 * already in use are preserved and only missing rows are appended.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const createdItemIds: string[] = [];
  try {
    const user = await currentUser();
    if (!user) return Response.json({ code: "UNAUTHORIZED", message: "Sign in to update catalog item count." }, { status: 401 });

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ code: "VALIDATION_ERROR", message: "Catalog item count must be between 1 and 50." }, { status: 400 });
    const { id } = await params;
    const listing = await prisma.smartListing.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        listingCount: true,
        productDetailsJson: true,
        items: { orderBy: { position: "asc" }, include: { _count: { select: { images: true, aiGenerations: true, fillJobs: true } } } },
      },
    });
    if (!listing) return Response.json({ code: "NOT_FOUND", message: "Smart Listing not found." }, { status: 404 });

    const target = parsed.data.listingCount;
    if (target === listing.listingCount) return Response.json({ ok: true, listingCount: target });
    const details = productDetailsSchema.parse(listing.productDetailsJson);

    if (target < listing.items.length) {
      const removed = listing.items.filter(item => item.position > target);
      const hasSavedWork = removed.some(item => item.title || item.description || item.mrp || item.meeshoPrice || item._count.images || item._count.aiGenerations || item._count.fillJobs);
      if (hasSavedWork) {
        return Response.json({ code: "COUNT_REDUCTION_BLOCKED", message: "This draft cannot be reduced because the removed items already contain saved work. Create a new Smart Listing if you need fewer catalog items." }, { status: 409 });
      }
      // The Neon HTTPS adapter intentionally has no transaction support. These
      // rows were just verified as disposable, so remove them one-by-one.
      for (const item of removed) await prisma.smartListingItem.delete({ where: { id: item.id } });
      await prisma.smartListing.update({ where: { id }, data: { listingCount: target } });
    } else {
      for (let position = listing.items.length + 1; position <= target; position += 1) {
        const item = await prisma.smartListingItem.create({ data: {
          smartListingId: listing.id,
          position,
          sku: generateProductSku(details.productName, listing.id, crypto.randomUUID(), position),
          status: "DRAFT",
        } });
        createdItemIds.push(item.id);
      }
      await prisma.smartListing.update({ where: { id }, data: { listingCount: target } });
    }

    return Response.json({ ok: true, listingCount: target });
  } catch (error) {
    for (const itemId of createdItemIds) {
      await prisma.smartListingItem.delete({ where: { id: itemId } }).catch(cleanupError => console.error("Catalog item cleanup failed.", cleanupError));
    }
    console.error("Catalog item count update failed.", error);
    return Response.json({ code: "COUNT_UPDATE_FAILED", message: "ListingKing could not update the catalog item count. Please try again." }, { status: 503 });
  }
}
