import { requireApiUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { templateCaptureSchema } from "@/lib/contracts";
import { Prisma } from "@prisma/client";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function GET(request: Request) {
  try {
    const user = await requireApiUser(request);
    if (!user) return Response.json({ code: "UNAUTHORIZED", message: "Your extension session has expired. Sign in again." }, { status: 401 });
    return Response.json(await prisma.template.findMany({ where: { userId: user.id, status: "ACTIVE" }, select: { id: true, name: true, categoryLabel: true, version: true, updatedAt: true }, orderBy: { updatedAt: "desc" } }));
  } catch (error) {
    console.error("Template list failed.", error);
    return Response.json({ code: "DATABASE_UNAVAILABLE", message: "ListingKing cannot reach its database. Your templates could not be loaded." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let createdTemplateId: string | null = null;
  try {
    const user = await requireApiUser(request);
    if (!user) return Response.json({ code: "UNAUTHORIZED", message: "Your extension session has expired. Sign in again, then save the template." }, { status: 401 });
    const parsed = templateCaptureSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ code: "VALIDATION_ERROR", message: "ListingKing could not validate the captured fields.", fieldErrors: parsed.error.flatten(), issues: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })).slice(0, 5) }, { status: 400 });

    // Prisma's Neon HTTP adapter sends each query over HTTPS. It supports
    // normal writes, but an implicit nested-create transaction can fail on
    // networks where the database's TCP/WebSocket path is unavailable. Save
    // the template and its captured fields as two compatible writes instead.
    const template = await prisma.template.create({
      data: {
        userId: user.id,
        name: parsed.data.name,
        categoryLabel: parsed.data.categoryLabel,
        schemaJson: json(parsed.data.schema)
      }
    });
    createdTemplateId = template.id;

    // `createMany` itself opens a transaction in Prisma's Neon HTTP adapter.
    // Capture fields one at a time instead: each is a normal HTTPS write and
    // a failed field triggers the cleanup below, so the seller never sees a
    // partial template.
    for (const { selectorCandidates, mapping, defaultValue, ...field } of parsed.data.schema.fields) {
      await prisma.templateField.create({
        data: {
          ...field,
          templateId: template.id,
          selectorCandidatesJson: json(selectorCandidates),
          mappingJson: json(mapping),
          defaultValueJson: defaultValue === undefined ? undefined : json(defaultValue)
        }
      });
    }

    return Response.json(template, { status: 201 });
  } catch (error) {
    // If adding fields fails, do not leave a half-captured template visible to
    // the seller. The cleanup is best-effort because the original error is
    // still the useful one for the extension to report.
    if (createdTemplateId) await prisma.template.delete({ where: { id: createdTemplateId } }).catch(() => undefined);
    console.error("Template capture failed.", error);
    return Response.json({ code: "DATABASE_UNAVAILABLE", message: "ListingKing cannot reach its database, so this template was not saved." }, { status: 503 });
  }
}
