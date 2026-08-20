import { describe, expect, it } from "vitest";
import { priceSchema } from "../lib/contracts";

describe("price constraints", () => {
  it("rejects selling prices above MRP", () => expect(priceSchema.safeParse({ mrp: 100, meeshoPrice: 120, defectivePrice: 80 }).success).toBe(false));
  it("rejects return prices above selling price", () => expect(priceSchema.safeParse({ mrp: 100, meeshoPrice: 90, defectivePrice: 91 }).success).toBe(false));
  it("accepts seller-entered valid prices", () => expect(priceSchema.safeParse({ mrp: 100, meeshoPrice: 90, defectivePrice: 80 }).success).toBe(true));
  it("accepts an omitted wrong or defective return price", () => expect(priceSchema.safeParse({ mrp: 100, meeshoPrice: 90 }).success).toBe(true));
});
