import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ContentGenerationError, geminiContentProvider, groqContentProvider, localContentProvider, normalizedInputHash } from "@/lib/generation";
import { productDetailsSchema } from "@/lib/contracts";
import { generateProductSku } from "@/lib/sku";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.email) return Response.json({ code: "UNAUTHORIZED", message: "Sign in to generate listing content." }, { status: 401 });
    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) return Response.json({ code: "UNAUTHORIZED", message: "Sign in to generate listing content." }, { status: 401 });
    const { id } = await context.params;
    const listing = await prisma.smartListing.findFirst({ where: { id, userId: user.id }, include: { items: { orderBy: { position: "asc" } } } });
    if (!listing) return Response.json({ code: "NOT_FOUND", message: "Smart Listing not found." }, { status: 404 });
    const input = productDetailsSchema.parse(listing.productDetailsJson);
    const inputHash = normalizedInputHash(input);
    const itemCount = listing.items.length;
    let generated;
    let provider = "local";
    let model = "template-v2";
    try {
      if (process.env.GROQ_API_KEY) {
        provider = "groq";
        model = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
        generated = await groqContentProvider.generate(input, itemCount);
      } else if (process.env.GEMINI_API_KEY) {
        provider = "gemini";
        model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
        generated = await geminiContentProvider.generate(input, itemCount);
      } else {
        generated = await localContentProvider.generate(input, itemCount);
      }
    } catch (error) {
      if (error instanceof ContentGenerationError) return Response.json({ code: "AI_GENERATION_FAILED", message: error.message }, { status: 502 });
      throw error;
    }

    if (generated.items.length !== listing.items.length) {
      return Response.json({ code: "AI_GENERATION_FAILED", message: "The AI returned the wrong number of listing items. Please try generating again." }, { status: 502 });
    }

    // Neon HTTPS does not support Prisma transactions or createMany. Each
    // validated result is stored as a normal write so generation works with
    // the same database connection as templates and image uploads.
    for (const [index, item] of listing.items.entries()) {
      const result = generated.items[index];
      await prisma.smartListingItem.update({ where: { id: item.id }, data: {
        title: result.title,
        description: result.description,
        sku: generateProductSku(result.title, listing.id, item.id, item.position),
      } });
      await prisma.aiGeneration.create({ data: {
        userId: user.id,
        smartListingItemId: item.id,
        provider,
        model,
        promptVersion: "v2",
        inputHash,
        outputJson: result,
        warningsJson: generated.warnings,
      } });
    }

    const items = await prisma.smartListingItem.findMany({ where: { smartListingId: id }, orderBy: { position: "asc" }, select: { id: true, position: true, title: true, description: true, mrp: true, meeshoPrice: true, defectivePrice: true, sku: true, validationJson: true } });
    return Response.json({ ...generated, itemCount: listing.items.length, provider, items });
  } catch (error) {
    console.error("Smart Listing content generation failed.", error);
    return Response.json({ code: "GENERATION_SAVE_FAILED", message: "ListingKing could not save the generated content. Please try again." }, { status: 503 });
  }
}
