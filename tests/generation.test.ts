import { describe, expect, it } from "vitest";
import { normaliseMarketplaceDescription } from "../lib/generation";
import type { ProductDetails } from "../lib/contracts";

const product: ProductDetails = {
  productName: "Japanese Gel",
  category: "Pain Relief Ointment",
  material: "",
  color: "",
  style: "",
  features: "light texture and seller-provided product details",
  audience: "adult customers",
  keywords: "",
  notes: ""
};

describe("marketplace-safe description generation", () => {
  it("removes risky marketplace, medical, promotional, and brand-like wording", () => {
    const description = normaliseMarketplaceDescription(
      "**Japanese Gel** is an Everyday Amazon choice with FDA approved results that guarantee it can cure pain. This official product is a best seller for Meesho shoppers and offers genuine support through a lightweight texture for regular use at home.",
      product
    );

    expect(description).not.toMatch(/japanese gel|everyday|amazon|fda|guarantee|cure|official|best seller|meesho|genuine/i);
    expect(description).not.toMatch(/[\n*•]/);
    expect(description.split(/\s+/).length).toBeGreaterThanOrEqual(35);
    expect(description.split(/\s+/).length).toBeLessThanOrEqual(45);
  });

  it("keeps descriptions as a single safe paragraph when AI output is too short", () => {
    const description = normaliseMarketplaceDescription("Everyday FDA approved cure.", product);

    expect(description).not.toMatch(/everyday|fda|cure|japanese gel/i);
    expect(description).not.toMatch(/[\n*•]/);
    expect(description.split(/\s+/).length).toBeGreaterThanOrEqual(35);
    expect(description.split(/\s+/).length).toBeLessThanOrEqual(45);
  });
});
