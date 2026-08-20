import { describe, expect, it } from "vitest";
import { generateProductSku, productSkuPattern } from "../lib/sku";

describe("product-based SKU generation", () => {
  it("uses product words and produces a stable unique SKU", () => {
    const sku = generateProductSku("Japanese Balm for Pain Relief", "listing-a", "item-a", 2);
    expect(sku).toMatch(productSkuPattern);
    expect(sku.startsWith("JAPANESE-BALM-002-")).toBe(true);
    expect(generateProductSku("Japanese Balm for Pain Relief", "listing-a", "item-a", 2)).toBe(sku);
    expect(generateProductSku("Japanese Balm for Pain Relief", "listing-a", "item-b", 2)).not.toBe(sku);
  });
});
