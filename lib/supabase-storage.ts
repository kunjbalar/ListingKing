import crypto from "node:crypto";

const allowedContentTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maximumBytes = 10 * 1024 * 1024;

function config() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.SUPABASE_BUCKET_NAME?.trim();
  if (!url || !serviceKey || !bucket) throw new Error("Supabase Storage is not configured. Add SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_BUCKET_NAME to .env.");
  return { url, serviceKey, bucket };
}

function extensionFor(contentType: string) {
  return contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
}

export async function uploadListingImage({ userId, listingId, itemId, role, file }: { userId: string; listingId: string; itemId: string; role: string; file: File }) {
  if (!allowedContentTypes.has(file.type)) throw new Error("Only JPG, PNG, and WEBP images are allowed.");
  if (!file.size || file.size > maximumBytes) throw new Error("Each image must be 10 MB or smaller.");

  const { url, serviceKey, bucket } = config();
  const bytes = Buffer.from(await file.arrayBuffer());
  const checksum = crypto.createHash("sha256").update(bytes).digest("hex");
  const storageKey = `users/${userId}/listings/${listingId}/items/${itemId}/${role.toLowerCase()}-${crypto.randomUUID()}.${extensionFor(file.type)}`;
  const response = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${storageKey.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": file.type, "x-upsert": "false" },
    body: bytes
  });
  if (!response.ok) throw new Error(`Supabase upload failed: ${await response.text()}`);
  return { storageKey, checksum };
}

export async function deleteListingImage(storageKey: string) {
  const { url, serviceKey, bucket } = config();
  const response = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: [storageKey] })
  });
  if (!response.ok) throw new Error(`Supabase delete failed: ${await response.text()}`);
}

export async function downloadListingImage(storageKey: string) {
  const { url, serviceKey, bucket } = config();
  const response = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${storageKey.split("/").map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
  });
  if (!response.ok) throw new Error(`Supabase download failed: ${await response.text()}`);
  return response;
}
