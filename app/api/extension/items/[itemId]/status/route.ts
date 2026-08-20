import { z } from "zod";
import { requireApiUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({ status: z.enum(["READY", "FILLING", "FILLED"]) });

export async function POST(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const user = await requireApiUser(request);
  if (!user) return Response.json({ code: "UNAUTHORIZED", message: "Extension sign-in is required." }, { status: 401 });
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ code: "VALIDATION_ERROR", message: "Specify READY, FILLING, or FILLED." }, { status: 400 });
  const { itemId } = await params;
  const item = await prisma.smartListingItem.findFirst({ where: { id: itemId, smartListing: { userId: user.id } }, select: { id: true, smartListingId: true, status: true } });
  if (!item) return Response.json({ code: "NOT_FOUND", message: "Listing item not found." }, { status: 404 });
  if (body.data.status === "FILLING" && item.status !== "READY") return Response.json({ code: "INVALID_STATE", message: "This item is no longer ready to fill." }, { status: 409 });
  if (body.data.status === "FILLED" && item.status !== "FILLING") return Response.json({ code: "INVALID_STATE", message: "Fill the item before confirming it as saved." }, { status: 409 });
  if (body.data.status === "READY" && item.status !== "FILLING") return Response.json({ code: "INVALID_STATE", message: "Only an in-progress item can be reset for a retry." }, { status: 409 });

  await prisma.smartListingItem.update({ where: { id: item.id }, data: { status: body.data.status } });
  if (body.data.status === "FILLED") {
    const remaining = await prisma.smartListingItem.count({ where: { smartListingId: item.smartListingId, status: { not: "FILLED" } } });
    await prisma.smartListing.update({ where: { id: item.smartListingId }, data: { status: remaining ? "PARTIALLY_FILLED" : "COMPLETED" } });
  } else if (body.data.status === "READY") {
    const filledCount = await prisma.smartListingItem.count({ where: { smartListingId: item.smartListingId, status: "FILLED" } });
    await prisma.smartListing.update({ where: { id: item.smartListingId }, data: { status: filledCount ? "PARTIALLY_FILLED" : "READY" } });
  }
  await prisma.auditLog.create({ data: { userId: user.id, action: body.data.status === "FILLING" ? "EXTENSION_FILL_STARTED" : body.data.status === "FILLED" ? "EXTENSION_ITEM_CONFIRMED" : "EXTENSION_FILL_RESET", entityType: "SmartListingItem", entityId: item.id } });
  return Response.json({ ok: true, status: body.data.status });
}
