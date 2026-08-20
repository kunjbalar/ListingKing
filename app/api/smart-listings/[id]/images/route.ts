import { ImageRole } from "@prisma/client";
import { currentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { deleteListingImage, uploadListingImage } from "@/lib/supabase-storage";

const roles: Record<string, ImageRole> = { front: "FRONT", side: "SIDE", detail: "DETAIL", back: "BACK" };

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ code: "UNAUTHORIZED", message: "Sign in to view listing images." }, { status: 401 });
  const { id } = await params;
  const listing = await prisma.smartListing.findFirst({ where: { id, userId: user.id }, include: { items: { orderBy: { position: "asc" }, include: { images: { orderBy: { sortOrder: "asc" } } } } } });
  if (!listing) return Response.json({ code: "NOT_FOUND", message: "Smart Listing not found." }, { status: 404 });
  return Response.json(listing.items.map(item => ({ id: item.id, position: item.position, images: item.images })));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ code: "UNAUTHORIZED", message: "Sign in to upload images." }, { status: 401 });
  const { id } = await params;
  const form = await request.formData();
  const role = roles[String(form.get("role") || "")];
  const position = Number(form.get("position"));
  const file = form.get("file");
  if (!role || !Number.isInteger(position) || position < 1 || !(file instanceof File)) return Response.json({ code: "VALIDATION_ERROR", message: "Provide an image file, role, and listing item position." }, { status: 400 });
  const item = await prisma.smartListingItem.findFirst({ where: { position, smartListing: { id, userId: user.id } } });
  if (!item) return Response.json({ code: "NOT_FOUND", message: "Listing item not found." }, { status: 404 });
  try {
    const uploaded = await uploadListingImage({ userId: user.id, listingId: id, itemId: item.id, role, file });
    const image = await prisma.listingImage.create({ data: { smartListingItemId: item.id, role, storageKey: uploaded.storageKey, checksum: uploaded.checksum, width: 0, height: 0, sortOrder: 0 } });
    return Response.json(image, { status: 201 });
  } catch (error) {
    console.error("Listing image upload failed.", error);
    return Response.json({ code: "IMAGE_UPLOAD_FAILED", message: error instanceof Error ? error.message : "Image upload failed." }, { status: 502 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ code: "UNAUTHORIZED", message: "Sign in to remove images." }, { status: 401 });
  const { id } = await params;
  const imageId = new URL(request.url).searchParams.get("imageId");
  if (!imageId) return Response.json({ code: "VALIDATION_ERROR", message: "Specify the image to remove." }, { status: 400 });
  const image = await prisma.listingImage.findFirst({ where: { id: imageId, item: { smartListing: { id, userId: user.id } } } });
  if (!image) return Response.json({ code: "NOT_FOUND", message: "Image not found." }, { status: 404 });
  try {
    await deleteListingImage(image.storageKey);
    await prisma.listingImage.delete({ where: { id: image.id } });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Listing image delete failed.", error);
    return Response.json({ code: "IMAGE_DELETE_FAILED", message: error instanceof Error ? error.message : "Image delete failed." }, { status: 502 });
  }
}
