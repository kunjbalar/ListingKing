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
 * A seller-facing SKU that identifies the product, while the random suffix
 * keeps it unique even when two listings have the same title.
 *
 * Format: PRODUCTNAME-skuCode-XXXXX (5 random digits)
 */
export function generateProductSku(productTitle: string, skuCode: number, listingKey: string, itemKey: string, position: number) {
  const clean = productTitle.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15) || "PRODUCT";
  const hash = crypto.createHash("sha256").update(`${listingKey}:${itemKey}:${position}`).digest("hex");
  const random = parseInt(hash.slice(0, 8), 16) % 100000;
  return `${clean}-${skuCode}-${String(random).padStart(5, "0")}`;
}

export const productSkuPattern = /^[A-Z0-9]{2,15}-\d{1,5}-\d{5}$/;

