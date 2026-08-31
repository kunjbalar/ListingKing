import { currentUser } from "@/lib/current-user";
import { productDetailsSchema } from "@/lib/contracts";
import { prisma } from "@/lib/prisma";
import { generateProductSku } from "@/lib/sku";
import { z } from "zod";

/** Keeps legacy drafts and new drafts on the same stored SKU format. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ code: "UNAUTHORIZED", message: "Sign in to generate SKU IDs." }, { status: 401 });
    const { id } = await params;
    const listing = await prisma.smartListing.findFirst({
      where: { id, userId: user.id },
      select: { id: true, productDetailsJson: true, items: { select: { id: true, position: true, title: true }, orderBy: { position: "asc" } } },
    });
    if (!listing) return Response.json({ code: "NOT_FOUND", message: "Smart Listing not found." }, { status: 404 });

    const details = productDetailsSchema.parse(listing.productDetailsJson);
    // Sequential writes avoid Prisma's transaction path, which is unavailable
    // with the Neon HTTPS adapter used by the local development database.
    for (const item of listing.items) {
      await prisma.smartListingItem.update({
        where: { id: item.id },
        data: { sku: generateProductSku(details.productName, details.skuCode, listing.id, item.id, item.position) },
      });
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Smart Listing SKU generation failed.", error);
    return Response.json({ code: "SKU_GENERATION_FAILED", message: "ListingKing could not generate SKU IDs. Please try again." }, { status: 503 });
  }
}

const skuUpdateSchema = z.object({ itemId: z.string().min(1), sku: z.string().trim().min(1).max(60) });

/** Allow sellers to manually update a single SKU value. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ code: "UNAUTHORIZED", message: "Sign in to update SKU IDs." }, { status: 401 });
    const { id } = await params;
    const parsed = skuUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ code: "VALIDATION_ERROR", message: "Provide a valid item ID and SKU value." }, { status: 400 });

    const item = await prisma.smartListingItem.findFirst({ where: { id: parsed.data.itemId, smartListingId: id, smartListing: { userId: user.id } } });
    if (!item) return Response.json({ code: "NOT_FOUND", message: "Listing item not found." }, { status: 404 });

    await prisma.smartListingItem.update({ where: { id: item.id }, data: { sku: parsed.data.sku } });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("SKU manual update failed.", error);
    return Response.json({ code: "SKU_UPDATE_FAILED", message: "ListingKing could not update the SKU. Please try again." }, { status: 503 });
  }
}
