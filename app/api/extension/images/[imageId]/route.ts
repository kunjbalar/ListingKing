import { requireApiUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { downloadListingImage } from "@/lib/supabase-storage";

export async function GET(request: Request, { params }: { params: Promise<{ imageId: string }> }) {
  const user = await requireApiUser(request);
  if (!user) return Response.json({ code: "UNAUTHORIZED", message: "Extension sign-in is required." }, { status: 401 });
  const { imageId } = await params;
  const image = await prisma.listingImage.findFirst({
    where: { id: imageId, item: { smartListing: { userId: user.id, status: { in: ["READY", "PARTIALLY_FILLED"] } } } },
    select: { storageKey: true },
  });
  if (!image) return Response.json({ code: "NOT_FOUND", message: "Stored image not found for this Ready listing." }, { status: 404 });
  try {
    const stored = await downloadListingImage(image.storageKey);
    return new Response(stored.body, {
      headers: {
        "Content-Type": stored.headers.get("content-type") || "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Extension image download failed.", error);
    return Response.json({ code: "IMAGE_DOWNLOAD_FAILED", message: error instanceof Error ? error.message : "Stored image could not be retrieved." }, { status: 502 });
  }
}
