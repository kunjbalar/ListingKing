import { z } from "zod";

export const productDetailsSchema = z.object({
  productName: z.string().trim().min(2).max(80),
  category: z.string().trim().max(80).default(""),
  material: z.string().trim().max(80).default(""),
  color: z.string().trim().max(60).default(""),
  style: z.string().trim().max(80).default(""),
  features: z.string().trim().min(3).max(800),
  audience: z.string().trim().max(80).default(""),
  keywords: z.string().trim().max(300).default(""),
  notes: z.string().trim().max(500).default("")
});

const optionalPositiveNumber = z.preprocess(value => value === "" || value === null || value === undefined ? undefined : value, z.coerce.number().positive().optional());

export const priceSchema = z.object({
  mrp: z.coerce.number().positive(),
  meeshoPrice: z.coerce.number().positive(),
  defectivePrice: optionalPositiveNumber
}).superRefine((value, ctx) => {
  if (value.meeshoPrice > value.mrp) ctx.addIssue({ code: "custom", path: ["meeshoPrice"], message: "Selling price cannot exceed MRP." });
  if (value.defectivePrice !== undefined && value.defectivePrice > value.meeshoPrice) ctx.addIssue({ code: "custom", path: ["defectivePrice"], message: "Return price cannot exceed selling price." });
});

export const draftSchema = z.object({
  templateId: z.string().min(1),
  name: z.string().trim().min(2).max(100),
  listingCount: z.coerce.number().int().min(1).max(50),
  productDetails: productDetailsSchema
});

export const templateCaptureSchema = z.object({
  name: z.string().trim().min(2).max(100),
  categoryLabel: z.string().trim().min(2).max(100),
  schema: z.object({ fields: z.array(z.object({
    fieldKey: z.string().min(1), label: z.string().min(1), inputType: z.string().min(1),
    required: z.boolean(), selectorCandidates: z.array(z.string()), mapping: z.record(z.string(), z.unknown()),
    defaultValue: z.unknown().optional(), position: z.number().int().nonnegative()
  })).min(1) })
});

export type ProductDetails = z.infer<typeof productDetailsSchema>;
