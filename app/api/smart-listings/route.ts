import crypto from "node:crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { draftSchema } from "@/lib/contracts";
import { generateProductSku } from "@/lib/sku";

async function currentUser() {
  const session = await auth(); if (!session?.user?.email) return null;
  return prisma.user.findUnique({ where: { email: session.user.email } });
}

export async function GET() {
  const user = await currentUser(); if (!user) return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  const listings = await prisma.smartListing.findMany({ where: { userId: user.id, status: { not: "ARCHIVED" } }, include: { template: { select: { name: true, version: true } }, items: { select: { id: true, position: true, status: true, sku: true } }, _count: { select: { items: true } } }, orderBy: { updatedAt: "desc" } });
  return Response.json(listings);
}

export async function POST(request: Request) {
  let createdListingId: string | null = null;
  try {
    const user = await currentUser();
    if (!user) return Response.json({ code: "UNAUTHORIZED", message: "Sign in to create a Smart Listing." }, { status: 401 });

    const payload = await request.json().catch(() => null);
    const parsed = draftSchema.safeParse(payload);
    if (!parsed.success) return Response.json({ code: "VALIDATION_ERROR", message: "Choose a template and complete the required Product name and Key features fields.", fieldErrors: parsed.error.flatten() }, { status: 400 });

    const template = await prisma.template.findFirst({ where: { id: parsed.data.templateId, userId: user.id, platform: "MEESHO", status: "ACTIVE" } });
    if (!template) return Response.json({ code: "TEMPLATE_NOT_FOUND", message: "Select an active Meesho template." }, { status: 404 });

    const batch = crypto.randomBytes(8).toString("hex").toUpperCase();
    // Prisma's Neon HTTPS adapter does not support nested writes because they
    // require a database transaction.  Create the parent and item rows one at
    // a time instead, so this works on networks where raw Postgres TCP is not
    // available.
    const listing = await prisma.smartListing.create({ data: {
      userId: user.id,
      templateId: template.id,
      name: parsed.data.name,
      listingCount: parsed.data.listingCount,
      productDetailsJson: parsed.data.productDetails,
    } });
    createdListingId = listing.id;

    for (let index = 0; index < parsed.data.listingCount; index += 1) {
      const position = index + 1;
      await prisma.smartListingItem.create({ data: {
        smartListingId: listing.id,
        position,
        sku: generateProductSku(parsed.data.productDetails.productName, batch, `${position}-${crypto.randomUUID()}`, position),
        status: "DRAFT",
      } });
    }

    return Response.json(listing, { status: 201 });
  } catch (error) {
    if (createdListingId) {
      // SmartListingItem has an on-delete cascade, so a failed partially-built
      // draft cannot leave orphan rows behind.
      await prisma.smartListing.delete({ where: { id: createdListingId } }).catch(cleanupError => console.error("Smart Listing draft cleanup failed.", cleanupError));
    }
    console.error("Smart Listing draft creation failed.", error);
    return Response.json({ code: "DRAFT_CREATE_FAILED", message: "ListingKing could not create the Smart Listing draft. Please try again." }, { status: 503 });
  }
}
