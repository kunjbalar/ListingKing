const SUPPLIER_HOSTS = new Set(["supplier.meesho.com", "supplier.meesho.in"]);

async function currentExtensionSession() {
  const local = await chrome.storage.local.get(["apiBase", "accessToken", "tokenExpiresAt"]);
  const accessToken = local.accessToken;
  const tokenExpiresAt = local.tokenExpiresAt;
  if (!accessToken || !tokenExpiresAt || Date.now() >= tokenExpiresAt) {
    await chrome.storage.local.remove(["accessToken", "tokenExpiresAt"]);
    return { apiBase: local.apiBase, accessToken: null, tokenExpiresAt: null };
  }
  return { apiBase: local.apiBase, accessToken, tokenExpiresAt };
}

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

// Chrome extension messages are JSON serialised. Do not return an ArrayBuffer
// from a message handler: it arrives as an unusable object in content scripts.
// Images are deliberately capped well below Chrome's message-size limit.
const IMAGE_MESSAGE_LIMIT_BYTES = 10 * 1024 * 1024;
const arrayBufferToBase64 = buffer => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};

async function dispatchNativeMouseClick(debuggee, x, y) {
  // Use Chromium's complete mouse path instead of a tap gesture. Meesho's
  // custom SVG checkbox and searchable menus listen to mouse down/up events;
  // a successful gesture command alone was not enough to prove that React
  // received a real click on the exact option.
  await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
    button: "none",
    buttons: 0
  });
  await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    buttons: 1,
    clickCount: 1
  });
  await pause(70);
  await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    buttons: 0,
    clickCount: 1
  });
}

async function dispatchNativeClickSequence(tabId, clicks) {
  const debuggee = { tabId };
  let attached = false;
  try {
    // Meesho ignores script-created click events for some multi-select menus.
    // Chromium's debugger Input domain produces the same trusted pointer events
    // as an ordinary mouse click, limited to the current Meesho tab.
    await chrome.debugger.attach(debuggee, "1.3");
    attached = true;
    await chrome.debugger.sendCommand(debuggee, "Page.bringToFront");
    for (const click of clicks) {
      await dispatchNativeMouseClick(debuggee, click.x, click.y);
      if (click.delayAfterMs) await pause(click.delayAfterMs);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Browser click permission was unavailable." };
  } finally {
    if (attached) {
      try { await chrome.debugger.detach(debuggee); } catch { /* The tab may have navigated. */ }
    }
  }
}

async function dispatchNativePageClick(tabId, x, y) {
  return dispatchNativeClickSequence(tabId, [{ x, y, delayAfterMs: 0 }]);
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const senderHost = sender.tab?.url ? new URL(sender.tab.url).host : "";

  if (message.type === "LK_NATIVE_CLICK") {
    if (!SUPPLIER_HOSTS.has(senderHost) || !sender.tab?.id) {
      respond({ ok: false, message: "Native clicks are allowed only on the Meesho Supplier Panel." });
      return;
    }
    const x = Number(message.payload?.x);
    const y = Number(message.payload?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      respond({ ok: false, message: "A valid Meesho click target was not found." });
      return;
    }
    dispatchNativePageClick(sender.tab.id, x, y).then(respond);
    return true;
  }

  if (message.type === "LK_SAVE_TEMPLATE") {
    if (!SUPPLIER_HOSTS.has(senderHost)) {
      respond({ ok: false, message: "Template capture is allowed only on the Meesho Supplier Panel." });
      return;
    }

    (async () => {
      await chrome.storage.local.set({ lastTemplateCapture: { state: "saving", name: message.payload?.name || "Untitled template", at: Date.now(), message: "Sending template to ListingKing..." } });
      const { apiBase, accessToken, tokenExpiresAt } = await currentExtensionSession();
      if (!apiBase || !accessToken || !tokenExpiresAt || Date.now() >= tokenExpiresAt) {
        const result = { ok: false, message: "Your extension session expired. Open the ListingKing extension and sign in again." };
        await chrome.storage.local.set({ lastTemplateCapture: { state: "failed", name: message.payload?.name || "Untitled template", at: Date.now(), message: result.message } });
        return result;
      }

      try {
        const response = await fetch(`${apiBase}/api/templates`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify(message.payload)
        });
        const body = await response.json().catch(() => null);
        const validationDetails = body?.issues?.map(issue => `${issue.path || "field"}: ${issue.message}`).join("; ");
        const result = response.ok
          ? { ok: true, template: { id: body.id, name: body.name } }
          : { ok: false, message: validationDetails || body?.message || `Template could not be saved (${response.status}).` };
        await chrome.storage.local.set({ lastTemplateCapture: { state: result.ok ? "saved" : "failed", name: result.ok ? result.template.name : (message.payload?.name || "Untitled template"), at: Date.now(), message: result.ok ? "Template stored in ListingKing." : result.message } });
        return result;
      } catch {
        const result = { ok: false, message: "ListingKing could not be reached. Keep pnpm dev running and check the database connection." };
        await chrome.storage.local.set({ lastTemplateCapture: { state: "failed", name: message.payload?.name || "Untitled template", at: Date.now(), message: result.message } });
        return result;
      }
    })().then(respond).catch(error => respond({ ok: false, message: `Template capture failed in the extension: ${error instanceof Error ? error.message : "Unknown error."}` }));
    return true;
  }

  if (message.type === "LK_GET_READY_LISTINGS") {
    if (!SUPPLIER_HOSTS.has(senderHost)) {
      respond({ ok: false, message: "Ready listings can be loaded only on the Meesho Supplier Panel." });
      return;
    }

    (async () => {
      const { apiBase, accessToken, tokenExpiresAt } = await currentExtensionSession();
      if (!apiBase || !accessToken || !tokenExpiresAt || Date.now() >= tokenExpiresAt) {
        return { ok: false, message: "Your extension session expired. Open the ListingKing extension and sign in again." };
      }
      try {
        const response = await fetch(`${apiBase}/api/extension/ready-listings`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(8_000)
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) return { ok: false, message: body?.message || `Ready listings could not be loaded (${response.status}).` };
        return { ok: true, listings: body };
      } catch {
        return { ok: false, message: "ListingKing could not be reached. Keep the dashboard server running, then try again." };
      }
    })().then(respond).catch(error => respond({ ok: false, message: `Ready listings could not be loaded: ${error instanceof Error ? error.message : "Unknown extension error."}` }));
    return true;
  }

  if (message.type === "LK_GET_LISTING_IMAGE") {
    if (!SUPPLIER_HOSTS.has(senderHost)) {
      respond({ ok: false, message: "Listing images can be loaded only on the Meesho Supplier Panel." });
      return;
    }
    (async () => {
      const { apiBase, accessToken, tokenExpiresAt } = await currentExtensionSession();
      if (!apiBase || !accessToken || !tokenExpiresAt || Date.now() >= tokenExpiresAt) return { ok: false, message: "Your extension session expired. Sign in again before attaching images." };
      try {
        const response = await fetch(`${apiBase}/api/extension/images/${encodeURIComponent(message.imageId)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          return { ok: false, message: body?.message || `Stored image could not be loaded (${response.status}).` };
        }
        const bytes = await response.arrayBuffer();
        if (!bytes.byteLength) return { ok: false, message: "The stored image was empty." };
        if (bytes.byteLength > IMAGE_MESSAGE_LIMIT_BYTES) {
          return { ok: false, message: "This stored image is larger than 10 MB and cannot be sent safely to Meesho. Upload a smaller JPEG or PNG." };
        }
        return {
          ok: true,
          base64: arrayBufferToBase64(bytes),
          byteLength: bytes.byteLength,
          contentType: response.headers.get("content-type")?.split(";", 1)[0] || "image/jpeg"
        };
      } catch {
        return { ok: false, message: "ListingKing could not retrieve the stored image. Check the server and Supabase connection." };
      }
    })().then(respond).catch(error => respond({ ok: false, message: `Stored image could not be loaded: ${error instanceof Error ? error.message : "Unknown extension error."}` }));
    return true;
  }

  if (message.type === "LK_UPDATE_ITEM_STATUS") {
    if (!SUPPLIER_HOSTS.has(senderHost)) {
      respond({ ok: false, message: "Listing status can be updated only on the Meesho Supplier Panel." });
      return;
    }
    (async () => {
      const { apiBase, accessToken, tokenExpiresAt } = await currentExtensionSession();
      if (!apiBase || !accessToken || !tokenExpiresAt || Date.now() >= tokenExpiresAt) return { ok: false, message: "Your extension session expired. Sign in again." };
      try {
        const response = await fetch(`${apiBase}/api/extension/items/${encodeURIComponent(message.itemId)}/status`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ status: message.status }) });
        const body = await response.json().catch(() => null);
        return response.ok ? { ok: true, status: body.status } : { ok: false, message: body?.message || `Item status could not be updated (${response.status}).` };
      } catch {
        return { ok: false, message: "ListingKing could not update this item status." };
      }
    })().then(respond).catch(error => respond({ ok: false, message: `Listing status could not be updated: ${error instanceof Error ? error.message : "Unknown extension error."}` }));
    return true;
  }

  if (!SUPPLIER_HOSTS.has(senderHost)) return;
  if (message.type === "LK_AUDIT") {
    chrome.storage.session.set({ lastFillReport: { ...message.payload, at: Date.now() } });
    respond({ ok: true });
  }
});
