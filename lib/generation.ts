import crypto from "node:crypto";
import type { ProductDetails } from "./contracts";

export type GeneratedItem = { title: string; description: string };
export type GeneratedContent = { items: GeneratedItem[]; warnings: string[] };
export interface ContentProvider { generate(input: ProductDetails, itemCount: number): Promise<GeneratedContent>; }

export class ContentGenerationError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); }
}

export const normalizedInputHash = (input: ProductDetails) => crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");

const titleAngles = ["Everyday Essential", "Daily Use Choice", "Home Care Pick", "Thoughtful Gift Option", "Convenient Routine", "Reliable Everyday Use", "Customer-Friendly Choice", "Practical Daily Essential"];

function normaliseTitle(raw: unknown, productName: string, index: number, used: Set<string>) {
  const candidate = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  const coreIndex = candidate.toLocaleLowerCase().indexOf(productName.toLocaleLowerCase());
  const hasCoreName = coreIndex >= 0;
  let title = hasCoreName
    ? `${candidate.slice(0, coreIndex)}${productName}${candidate.slice(coreIndex + productName.length)}`
    : `${productName} - ${candidate || titleAngles[index % titleAngles.length]}`;
  if (title.length > 100) {
    const suffix = candidate.replace(new RegExp(productName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "").replace(/^\s*[-–—|:]\s*/, "").trim();
    title = suffix ? `${productName} - ${suffix.slice(0, Math.max(0, 97 - productName.length)).trimEnd()}` : productName;
  }
  const key = title.toLocaleLowerCase();
  if (!used.has(key)) { used.add(key); return title; }

  const angle = titleAngles[index % titleAngles.length];
  title = `${productName} - ${angle}`.slice(0, 100).trim();
  let attempt = 2;
  while (used.has(title.toLocaleLowerCase())) {
    const suffix = ` ${attempt++}`;
    title = `${productName} - ${angle}`.slice(0, 100 - suffix.length).trimEnd() + suffix;
  }
  used.add(title.toLocaleLowerCase());
  return title;
}

const DESCRIPTION_UNSAFE_PATTERNS = [
  /\b(?:amazon|flipkart|myntra|meesho|snapdeal|nykaa|instagram|facebook|whatsapp)\b/gi,
  /\b(?:cure|cures|curing|treat|treats|treated|treatment|heal|heals|healing|diagnose|diagnosed|diagnosis|prescription|medicated|medication|medicine|drug|antibiotic|painkiller|anti[- ]?inflammatory|clinically\s+proven|doctor(?:'s)?\s+recommended)\b/gi,
  /\b(?:fda|ce|iso|gmp)\s*(?:approved|certified|registered)?\b/gi,
  /\b(?:guarantee|guaranteed|guarantees|best[- ]?seller|no\.?\s*1|number\s+one|official|original|genuine|authentic|limited[- ]?time|discount|offer|offers|sale|free\s+shipping|cash\s+on\s+delivery)\b/gi,
  /\b(?:everyday|all[- ]?day)\b/gi,
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanMarketplaceDescription(raw: string, input: ProductDetails) {
  let cleaned = raw
    .replace(/\*+/g, "")
    .replace(/[`#_~]+/g, "")
    .replace(/^[\s•\-*]+/gm, "")
    .replace(/[®™]/g, "")
    // A seller's product name can contain a brand-like or prohibited token.
    // Keep it available for title generation, but do not repeat it in the
    // marketplace description where Meesho's keyword checker evaluates copy.
    .replace(new RegExp(escapeRegExp(input.productName), "gi"), "this product");
  for (const pattern of DESCRIPTION_UNSAFE_PATTERNS) cleaned = cleaned.replace(pattern, " ");
  return cleaned
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([,.!?;:])\s*([,.!?;:])+/g, "$1")
    .trim();
}

function localDescription(input: ProductDetails) {
  const context = [input.category, input.material, input.color, input.style].filter(Boolean).join(", ");
  const buyer = input.audience ? `It is presented for ${input.audience} based on seller-provided details.` : "It is presented using seller-provided specifications.";
  return `This product is described using seller-provided details. Key features include ${input.features}. ${context ? `Available product context includes ${context}. ` : ""}${buyer} Review the images and product details to confirm suitability before purchase. The listing focuses on the supplied specifications and visible product presentation.`.replace(/\s+/g, " ").trim();
}

export function normaliseMarketplaceDescription(raw: unknown, input: ProductDetails) {
  const cleaned = typeof raw === "string" ? cleanMarketplaceDescription(raw, input) : "";
  const words = cleaned.split(" ").filter(Boolean);
  if (words.length < 35) {
    const fallback = cleanMarketplaceDescription(localDescription(input), input).split(" ").filter(Boolean).slice(0, 45).join(" ").replace(/[,:;\-–—]+$/, "").trim();
    return /[.!?]$/.test(fallback) ? fallback : `${fallback}.`;
  }
  const paragraph = words.slice(0, 45).join(" ").replace(/[,:;\-–—]+$/, "").trim();
  return /[.!?]$/.test(paragraph) ? paragraph : `${paragraph}.`;
}

function parseGeneratedContent(text: string, input: ProductDetails, itemCount: number): GeneratedContent {
  const source = text.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw new ContentGenerationError("The AI response was not valid JSON. Please try generating again."); }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { items?: unknown }).items)) {
    throw new ContentGenerationError("The AI response did not contain listing items. Please try generating again.");
  }
  const rawItems = (parsed as { items: unknown[] }).items;
  if (rawItems.length !== itemCount) throw new ContentGenerationError(`The AI returned ${rawItems.length} items instead of ${itemCount}. Please try generating again.`);
  const usedTitles = new Set<string>();
  const items = rawItems.map((raw, index) => {
    const value = raw && typeof raw === "object" ? raw as { title?: unknown; description?: unknown } : {};
    return { title: normaliseTitle(value.title, input.productName, index, usedTitles), description: normaliseMarketplaceDescription(value.description, input) };
  });
  const warnings = Array.isArray((parsed as { warnings?: unknown }).warnings)
    ? (parsed as { warnings: unknown[] }).warnings.filter((warning): warning is string => typeof warning === "string").slice(0, 5)
    : [];
  return { items, warnings };
}

function contentPrompt(input: ProductDetails, itemCount: number) {
  return `Generate content for exactly ${itemCount} separate Meesho catalog listings. Return JSON only in this exact form: {"items":[{"title":"...","description":"..."}],"warnings":[]}.

Seller product name (must be preserved verbatim in every title): ${input.productName}
Seller key features (the source of product claims): ${input.features}
Optional seller context: ${JSON.stringify({ category: input.category, material: input.material, color: input.color, style: input.style, audience: input.audience, keywords: input.keywords, notes: input.notes })}

Title requirements:
- Return exactly ${itemCount} titles, one for each item.
- Every title must contain the exact seller product name "${input.productName}" unchanged; it is the core of the title.
- Each title must be unique, search-friendly, and 50–80 characters where the product name length allows it; never exceed 100 characters.
- Vary genuine search angles such as use case, audience, form, or seller-provided attributes. Do not add an unverified brand, certification, medical promise, offer, measurement, material, or performance claim.

Description requirements:
- Write a distinct, professional description for every item, never a title or a single word.
- Write one plain paragraph of 35–45 words. Do not use Markdown, headings, bullet points, asterisks, labels, or line breaks.
- Explain the seller-provided key features and customer relevance using only supported facts. Do not make medical, safety, certification, ratings, price, offer, stock, or unsupported material claims.
- Use only generic, search-friendly category and use-case keywords supported by the seller facts. Never invent or repeat a brand, trademark, company, marketplace, competitor, celebrity, named product, country-origin adjective, certification, or regulated/illegal keyword. The seller product name is input context, not a brand to copy into the description; refer to "this product" when needed.
- Never use promotional or unverifiable wording such as "best seller", "official", "original", "genuine", "guaranteed", "everyday", "all-day", "instant", "cure", "treat", "heal", "clinically proven", "doctor recommended", discount, shipping, or price language.
- The description must be different from its title.`;
}

export const localContentProvider: ContentProvider = {
  async generate(input, itemCount) {
    const usedTitles = new Set<string>();
    return {
      items: Array.from({ length: itemCount }, (_, index) => ({
        title: normaliseTitle(`${input.productName} - ${titleAngles[index % titleAngles.length]}`, input.productName, index, usedTitles),
        description: normaliseMarketplaceDescription(localDescription(input), input),
      })),
      warnings: ["AI is not configured, so ListingKing used a local draft. Review all marketplace claims before saving."],
    };
  }
};

async function readError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  return body?.error?.message || body?.message || fallback;
}

export const groqContentProvider: ContentProvider = {
  async generate(input, itemCount) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new ContentGenerationError("Groq is not configured.");
    const model = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You create accurate marketplace copy. Follow the seller facts exactly and output only the requested JSON." },
          { role: "user", content: contentPrompt(input, itemCount) }
        ],
        response_format: { type: "json_object" },
        reasoning_effort: "low",
        reasoning_format: "hidden",
        max_completion_tokens: Math.min(12000, Math.max(1000, itemCount * 180)),
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new ContentGenerationError(await readError(response, `Groq generation failed (${response.status}).`), response.status);
    const body = await response.json();
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new ContentGenerationError("Groq returned an empty response. Please try generating again.");
    return parseGeneratedContent(text, input, itemCount);
  }
};

export const geminiContentProvider: ContentProvider = {
  async generate(input, itemCount) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return localContentProvider.generate(input, itemCount);
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: contentPrompt(input, itemCount) }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.7 } }),
      signal: AbortSignal.timeout(45_000)
    });
    if (!response.ok) throw new ContentGenerationError(await readError(response, `Gemini generation failed (${response.status}).`), response.status);
    const body = await response.json();
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") throw new ContentGenerationError("Gemini returned an empty response. Please try generating again.");
    return parseGeneratedContent(text, input, itemCount);
  }
};
