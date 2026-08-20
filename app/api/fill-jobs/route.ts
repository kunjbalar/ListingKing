import { requireApiUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { Prisma } from "@prisma/client";

const json = (value: unknown) => value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function POST(request: Request) {
  const user = await requireApiUser(request); if (!user) return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  const data = z.object({ itemId: z.string(), templateVersion: z.number().int(), status: z.enum(["SUCCESS", "PARTIAL", "FAILED", "DRY_RUN"]), results: z.unknown().optional(), error: z.unknown().optional() }).safeParse(await request.json());
  if (!data.success) return Response.json({ code: "VALIDATION_ERROR" }, { status: 400 });
  const item = await prisma.smartListingItem.findFirst({ where: { id: data.data.itemId, smartListing: { userId: user.id } } }); if (!item) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
  const job = await prisma.fillJob.create({ data: { userId: user.id, smartListingItemId: item.id, templateVersion: data.data.templateVersion, status: data.data.status, finishedAt: new Date(), resultsJson: json(data.data.results), errorJson: json(data.data.error) } });
  if (data.data.status === "SUCCESS") await prisma.smartListingItem.update({ where: { id: item.id }, data: { status: "FILLED" } });
  return Response.json(job, { status: 201 });
}
