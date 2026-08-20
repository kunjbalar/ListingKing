import crypto from "node:crypto";

export function generateSku(prefix: string, category: string, batchId: string, position: number, random: string) {
  const clean = (v: string, fallback: string) => v.split("@")[0].toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || fallback;
  return `${clean(prefix, "SELLER")}-${clean(category, "GEN")}-${batchId.slice(-6).toUpperCase()}-${String(position).padStart(3, "0")}-${clean(random, "X7K3").slice(0, 4)}`;
}

export const skuPattern = /^[A-Z0-9]{2,6}-[A-Z0-9]{2,6}-[A-Z0-9]{6}-\d{3}-[A-Z0-9]{4}$/;

function skuWords(value: string) {
  return value.toUpperCase().match(/[A-Z0-9]+/g)?.filter(Boolean) || [];
}

/**
 * A seller-facing SKU that identifies the product, while the hash keeps it
 * unique even when two listings have the same title.
 */
export function generateProductSku(productTitle: string, listingKey: string, itemKey: string, position: number) {
  const words = skuWords(productTitle);
  const first = (words[0] || "PRODUCT").slice(0, 8);
  const second = (words[1] || words[0] || "ITEM").slice(0, 8);
  const unique = crypto.createHash("sha256").update(`${listingKey}:${itemKey}:${position}`).digest("hex").slice(0, 4).toUpperCase();
  return `${first}-${second}-${String(position).padStart(3, "0")}-${unique}`;
}

export const productSkuPattern = /^[A-Z0-9]{2,8}-[A-Z0-9]{2,8}-\d{3}-[A-F0-9]{4}$/;
