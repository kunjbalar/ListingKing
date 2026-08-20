import { currentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { priceSchema } from "@/lib/contracts";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ code: "UNAUTHORIZED", message: "Sign in before making a listing Ready." }, { status: 401 });

    const { id } = await params;
    const listing = await prisma.smartListing.findFirst({
      where: { id, userId: user.id },
      include: { template: { select: { name: true, version: true, status: true } }, items: { include: { images: true } } },
    });
    if (!listing) return Response.json({ code: "NOT_FOUND", message: "Smart Listing not found." }, { status: 404 });
    if (listing.template.status !== "ACTIVE") return Response.json({ code: "TEMPLATE_NOT_READY", message: "The captured Meesho template needs to be remapped before this listing can be made Ready." }, { status: 400 });

    for (const item of listing.items) {
      if (!item.title || !item.description || !item.sku) {
        return Response.json({ code: "INCOMPLETE_CONTENT", message: `Item ${item.position} needs a title, description, and SKU.` }, { status: 400 });
      }
      const inventory = item.validationJson && typeof item.validationJson === "object" ? (item.validationJson as { inventory?: unknown }).inventory : undefined;
      if (!Number.isInteger(Number(inventory)) || Number(inventory) < 1) {
        return Response.json({ code: "INVALID_INVENTORY", message: `Item ${item.position} needs a valid inventory value.` }, { status: 400 });
      }
      const price = priceSchema.safeParse({ mrp: item.mrp, meeshoPrice: item.meeshoPrice, defectivePrice: item.defectivePrice });
      if (!price.success) return Response.json({ code: "INVALID_PRICING", message: `Item ${item.position} has invalid pricing. MRP and Meesho price are required; a wrong / defective return price is optional and cannot exceed selling price.` }, { status: 400 });
      if (!item.images.some(image => image.role === "FRONT")) {
        return Response.json({ code: "MISSING_FRONT_IMAGE", message: `Item ${item.position} needs one stored front image before it can be made Ready.` }, { status: 400 });
      }
    }

    // Validation above completes before writes begin.  Save individually to
    // stay compatible with Neon HTTPS, which deliberately has no transaction
    // transport for Prisma.
    for (const item of listing.items) {
      await prisma.smartListingItem.update({ where: { id: item.id }, data: { status: "READY" } });
    }
    await prisma.smartListing.update({ where: { id }, data: { status: "READY" } });
    try {
      await prisma.auditLog.create({ data: { userId: user.id, action: "SMART_LISTING_READY", entityType: "SmartListing", entityId: id, metadataJson: { itemCount: listing.items.length, templateVersion: listing.template.version } } });
    } catch (auditError) {
      // The listing is already Ready; audit failure must not make the extension
      // believe that it is not. The next successful action will be audited.
      console.error("Smart Listing Ready audit write failed.", auditError);
    }

    return Response.json({ status: "READY", message: `${listing.items.length} item${listing.items.length === 1 ? " is" : "s are"} Ready for the ListingKing extension.` });
  } catch (error) {
    console.error("Smart Listing Ready update failed.", error);
    return Response.json({ code: "READY_UPDATE_FAILED", message: "ListingKing could not make this Smart Listing Ready. Please try again." }, { status: 503 });
  }
}
