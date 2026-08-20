# ListingKing: technical handoff for the next model

You are taking over a local project at `D:\ListingKing`. The user is non-technical and wants you to fix the product, not merely describe code. Do not ask them to repeat background that is written here. Do not request, print, or copy passwords, OTPs, cookies, database URLs, API keys, or Supabase keys.

## Product goal

ListingKing is a Meesho-only catalog-listing assistant. It is **not** meant to submit a catalog automatically. Its intended workflow is:

1. Seller signs into ListingKing web app and its browser extension with the same ListingKing account.
2. On Meesho Supplier Panel **Add Single Catalog**, seller captures the current category form as a reusable template. The extension stores field labels, selector candidates, default values, and mappings in ListingKing.
3. In the web app the seller chooses that saved template, creates a Smart Listing batch (1–50 items), uploads/pairs product images, enters or generates titles/descriptions/prices, reviews SKU IDs, then saves it as **Ready**.
4. The extension loads only that account's Ready Smart Listings. On Meesho, the seller chooses **Fill product 1**. The extension should fill exactly one product, attach its stored images, never submit the catalog, and wait for the seller to click Meesho's **Save and Go Back**.
5. Seller clicks **Confirm product saved** in ListingKing extension only after Meesho save. This changes the item from `FILLING` to `FILLED` and exposes the next Ready item. A fully filled batch is no longer shown as Ready. For a new batch, the seller reuses the same template; they do not need to create a new template.

## Project architecture

- Next.js 15 / React 19 web app, Prisma ORM, PostgreSQL database hosted on Neon.
- Authentication is local email/password through NextAuth. The extension receives a short-lived extension token from `POST /api/extension/token`; it is deliberately 15 minutes and stored in `chrome.storage.local`.
- Images are persisted in Supabase Storage. Image metadata is in Neon. Do not place Supabase service-role values in the browser extension or frontend.
- Gemini is used for title/description generation in `lib/generation.ts`. If Gemini fails or no key exists, server intentionally uses a local draft fallback and tells user to review it.
- Browser extension is Manifest V3 in `D:\ListingKing\extension` and is loaded unpacked in Brave. Important files:
  - `extension/content.js`: injected Meesho panel, template capture, form filling, image attach logic.
  - `extension/background.js`: token/API calls, image retrieval, item status changes, attempted browser-native click support.
  - `extension/popup.js`: account login and saved template display.
  - `extension/manifest.json`: current manifest version is `0.1.27` at handoff time.

## Database model (Prisma)

The authoritative schema is `prisma/schema.prisma`.

- `Template`: saved Meesho category template; `schemaJson` contains captured fields; template status can be `ACTIVE`, `NEEDS_REMAPPING`, `ARCHIVED`.
- `TemplateField`: individual captured field data, including selector candidates/mapping/default value.
- `SmartListing`: batch linked to a template; statuses include `DRAFT`, `READY`, `PARTIALLY_FILLED`, `COMPLETED`, etc.
- `SmartListingItem`: one catalog item with `title`, `description`, `mrp`, `meeshoPrice`, `defectivePrice`, `sku`, `validationJson`, and item status `DRAFT/READY/FILLING/FILLED/ERROR`.
- `ListingImage`: Supabase storage key and role `FRONT/SIDE/DETAIL/BACK` for a SmartListingItem.
- `AiGeneration`, `FillJob`, and `AuditLog` keep generation/fill history.

## Important APIs

- `GET/POST /api/smart-listings`
- `GET/PATCH /api/smart-listings/[id]`
- `POST /api/smart-listings/[id]/generate`
- `GET/POST/DELETE /api/smart-listings/[id]/images`
- `POST /api/smart-listings/[id]/ready`
- `POST /api/extension/token`
- `GET /api/extension/ready-listings`
- `GET /api/extension/images/[imageId]`
- `POST /api/extension/items/[itemId]/status`

The old Prisma error about `template` inside `items.include` was fixed: `template` belongs on the SmartListing include, not inside SmartListingItem include.

## What already works or was implemented

- User registration/sign-in and error handling were repaired after an initial Neon connection issue.
- Template capture from the extension can save a template. An example user template was named `japanese balm` / `japanese balm batch`.
- Dashboard Templates and Smart Listings are connected to the same logged-in user.
- Smart Listing wizard has five steps: Set up, Images, Content & prices, SKU IDs, Review.
- Uploaded wizard images are saved to Supabase and persisted as ListingImage records. They are not merely browser-memory previews.
- Ready action persists a Smart Listing in Neon and exposes its Ready item to extension API.
- Extension loads Ready listings and has `Fill product 1`, `Retry product fill`, `Confirm product saved`, `Capture template`, `Check page fields`, `Reload listings`, and `Stop filling` controls.
- Extension uses Smart Listing item values for title, description, MRP, Meesho price, defective price, inventory (from `validationJson.inventory`, default 1), and SKU, rather than the old template default value where appropriate.
- Image download uses the authenticated ListingKing API and attempts to place Supabase-backed images in Meesho's exact **Add Images** input. This has not yet been end-to-end verified across categories.
- Extension does not click Meesho's final Submit Catalog button. That is deliberately seller-controlled.

## Current critical bug: Meesho Size -> Free Size -> Apply

This is the blocker. The user has repeatedly reloaded the unpacked extension and tested it on Meesho's Add Single Catalog page. The extension fills many normal text/select fields, but it does **not reliably complete** this mandatory Meesho workflow:

`Size input -> Free Size row -> Apply -> dynamic price table appears`

The user must not have to do this manually in the finished product. Until it completes, the dynamic row for Meesho Price, Wrong/Defective Returns Price, MRP, Inventory, and SKU cannot be filled reliably.

### Exact live Meesho DOM facts verified with browser access

These facts came from the user's active signed-in Meesho page, not guesses:

- Size is a readonly input with `placeholder="Select"`, no `name`, and a generated dynamic ID such as `mui-13` or `mui-17`. Do **not** persist or rely on the ID.
- Stable visible controls include: `#supplier_gst_percent`, `#hsn_code`, `#capacity`, `#generic_name`, `#maximum_shelf_life`, `#multipack` (Net Quantity), `#country_of_origin`.
- Opening Size produces a visible `ul[role="menu"]` with exact text:
  `Free Size`, `Clear Filter`, `Apply`.
- The real selectable control is the small `<svg>` checkbox in the same immediate row as the nested `Free Size` `<p>` (`MuiTypography...`). Live testing on the user's page showed that clicking the label `<p>` or enclosing row did **not** change the checkbox, while clicking that SVG changed it to a checked-path SVG. A real browser click on the SVG, then the menu `button` named `Apply`, set the Size input to `Free Size` and made the price row appear.
- The checkbox `input[type=checkbox][aria-label=Checkbox]` on this page belongs to **Copy price details to all sizes**, not to the Size picker. Earlier logic incorrectly matched it; do not reuse it for Size.
- When Size has been applied, exact price-row input IDs observed are:
  `#meesho_price`, `#only_wrong_return_price`, `#product_mrp`, `#inventory`, `#supplier_sku_id`.
- Net Quantity is the readonly multiselect control `#multipack`. It must eventually select the saved net quantity (usually `1`).

### Current extension implementation and failed attempts

`extension/content.js` currently has `chooseMeeshoFreeSize`, `ensureMeeshoSize`, and `fillPriceAndSkuRow`.

Attempts already made and their outcomes:

1. Generic selector/captured field mapping for Size: failed because generated `mui-*` IDs change per page load and a legacy template may lack a usable Size selector.
2. Generic text-to-checkbox matching: failed because it selected the unrelated **Copy price details to all sizes** checkbox.
3. Clicking a surrounding Free Size container: failed; it can open/close the popover instead of selecting the row.
4. Full synthetic pointer sequence (`pointerdown/mousedown/pointerup/mouseup/click`): failed; it can toggle Meesho MUI state twice, causing opening/closing or selecting/clearing.
5. Clean DOM click (`element.click()`) on the Free Size `<p>`: attempted, but not confirmed reliable in the extension context.
6. Chrome `debugger` permission with `Input.dispatchMouseEvent`: added in versions 0.1.18 onward to create trusted browser mouse events. User still reported failures. Do not assume `chrome.debugger.attach` succeeds; capture and expose its error if retaining this route.
7. `chrome.scripting` MAIN-world React-handler invocation: added in 0.1.21 but caused a false success (could return `ok` without opening the menu). It was removed in v0.1.26, together with the unused `scripting` permission.
8. Current v0.1.27 logic is a one-pass state machine: it opens Size once; locates the Free Size SVG checkbox; sends a semantic click directly to that SVG; waits for its checkmark; if no checkmark appears, sends one Chromium synthesized mouse tap to that same SVG; only then clicks Apply. It waits for `Size.value === "Free Size"` plus all five price-field IDs. It never re-clicks the Size trigger and it now stops before Apply if the blue tick is absent. This has passed syntax checks and direct live DOM verification, but remains **not end-to-end verified through the unpacked extension after v0.1.27 reload**.

### User-reported latest behavior

- v0.1.19: Size opened repeatedly (reported as opening three times) but did not select Free Size/Apply.
- v0.1.21: Size sometimes did not open due to the false-success handler.
- v0.1.22: user still reported Size selection failure.
- v0.1.27 is the latest patch and has passed `node --check extension/content.js` and `node --check extension/background.js`, not an end-to-end extension test.
- v0.1.27 removes the multi-click retry loop, targets the verified SVG checkbox rather than the non-selecting label text, and refuses to press Apply without a visible tick.

## Current image-upload fix awaiting end-to-end verification

The user reports that their required Meesho front image stays visible but the ListingKing image does not appear as a second thumbnail. Live DOM inspection found these Meesho inputs:

- `#getFile`: original/default catalog image input. Do not use it for ListingKing's additional images.
- `#changeFrontImage`: replaces the seller's required first image. Do not use it for this workflow.
- `#addMoreImagesInput[data-testid="addMoreImagesInput"]`: the correct `multiple` **Add Images** input. It is the only target ListingKing should use so the seller's default front image remains and ListingKing adds another thumbnail.

Previous image code had two defects:

1. `background.js` attempted to return an `ArrayBuffer` through `chrome.runtime.sendMessage`. Chrome extension messaging is JSON serialized, so this did not reliably arrive as usable image bytes.
2. `content.js` treated `input.files.length > 0` as a successful Meesho upload, which only proved a local FileList was assigned; it did not prove Meesho rendered a thumbnail.

v0.1.27 fixes this by Base64-encoding a maximum 10 MB image in the background worker, validating/reconstructing the JPEG/PNG file in the content script, targeting only `#addMoreImagesInput`, dispatching `input/change/blur`, and reporting success only after the Add Images card visibly gains a thumbnail. If Meesho does not show a new thumbnail, the panel must say so exactly rather than falsely claiming an attachment.

## Required next debugging approach

Do not continue blind version bumps. Use the user-provided live Meesho browser access and inspect actual state immediately after **one** Fill click.

1. Confirm the user has actually reloaded the unpacked extension from `brave://extensions` and refreshed Meesho. Both the manifest and panel header must show `v0.1.27` for this build.
2. Add observable diagnostics to the ListingKing panel or extension service-worker log: whether Size input was found, whether the correct Size menu was found, whether `Free Size` row was found, which click method was used, the native/debugger error if any, and the Size value after Apply. Do not silently return `ok`.
3. Validate every click attempt by reading the Size input and menu state. A method that returns success without `Size.value === "Free Size"` is a failure and must fall back.
4. Use exact selectors above. Never query a generic checkbox for Free Size; use the SVG directly beside the exact `Free Size` text and verify its checked path before Apply.
5. If browser-level trusted clicks fail, diagnose `chrome.debugger` service-worker errors rather than adding more synthetic click patterns. A trusted browser click was proven by Playwright, so the likely remaining issue is the extension-to-debugger path or target-coordinate verification.
6. Once Size selection succeeds, verify the five exact price IDs are populated with Smart Listing item values and remain stable after Meesho validation rerenders. Use direct IDs, dispatch `input/change/blur`, wait for each rerender, and re-check values.
7. Confirm the Add Images card gains a second thumbnail when the Smart Listing contains one Supabase-backed JPEG/PNG. Do not replace the existing front image and do not claim image success based only on `input.files`.
8. Then fix Net Quantity `#multipack` with similarly verified menu selection.
9. Then perform an end-to-end test with a new Ready Smart Listing item. Never mark it FILLED until the seller has manually clicked Meesho's Save and Go Back.

## User expectations and UX constraints

- User expects a production-quality Listify-like flow. They strongly dislike demo UI or advice that asks them to manually perform a step the automation should do.
- They want the extension panel polished and clear. It should show precise error messages, not generic `not ready` or silent success.
- A saved Template is different from a Smart Listing batch. Explain this distinction simply when needed.
- A completed item is intentionally absent from Ready listings; this is not data loss. A new Smart Listing can reuse the Japanese balm template.
- Do not make the extension submit, publish, or confirm a Meesho catalog automatically. Seller review and final Meesho save remain manual.

## Commands and verification

- Run the website with `pnpm dev` from `D:\ListingKing`.
- Load/reload the unpacked extension folder `D:\ListingKing\extension` in Brave.
- Basic available extension checks:
  `node --check extension/content.js`
  `node --check extension/background.js`
- Node modules/build state has previously been inconsistent, so do not claim `pnpm build` or tests pass unless you actually run them successfully.
- Use `apply_patch` for code edits. Preserve unrelated user changes. There is no trustworthy clean git status to reset.

## Security

- Extension must only operate on `supplier.meesho.com` / `supplier.meesho.in` and should never read Meesho password, cookies, payment details, or submit catalog.
- Extension session token is intentionally 15 minutes. It is stored in `chrome.storage.local`; expiry requires user to sign in again.
- Keep API keys and Supabase service role server-only. Do not echo `.env` values in chat, files, browser, logs, or prompts.
