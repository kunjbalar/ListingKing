(() => {
  if (window.top !== window || document.getElementById("listingking-panel")) return;

  let stopped = false;
  let readyListings = [];
  let selectedListingId = "";
  let lastSizeFailure = "";
  const SAFE_TYPES = new Set(["text", "textarea", "select", "checkbox", "radio", "number"]);
  const isSensitive = input => /password|token|cookie|card|payment/i.test(`${input.name} ${input.id} ${input.autocomplete}`);
  const labelFor = input => input.labels?.[0]?.innerText?.trim() || input.getAttribute("aria-label") || input.name || input.id || "Unlabelled field";
  const toast = (text, error = false) => {
    const node = document.querySelector("#listingking-panel .lk-status");
    if (node) {
      node.textContent = text;
      node.style.color = error ? "#a92d18" : "#34745b";
    }
  };
  const backgroundMessage = message => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ListingKing did not respond within 8 seconds. Reload the extension and try again.")), 8_000);
    chrome.runtime.sendMessage(message).then(
      response => { clearTimeout(timer); resolve(response); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
  const nativeSet = (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
    setter?.call(element, value);
    ["input", "change", "blur"].forEach(type => element.dispatchEvent(new Event(type, { bubbles: true })));
    element.style.outline = "2px solid #d8f24f";
  };
  const getFieldMap = () => {
    const usedKeys = new Map();
    return [...document.querySelectorAll("input, textarea, select")]
      .filter(input => {
        const type = input.type === "textarea" ? "textarea" : input.type === "select-one" ? "select" : input.type || "text";
        return SAFE_TYPES.has(type) && !isSensitive(input) && input.offsetParent;
      })
      .map((input, position) => {
        const baseKey = input.name || input.id || `field_${position}`;
        const duplicateNumber = usedKeys.get(baseKey) || 0;
        usedKeys.set(baseKey, duplicateNumber + 1);
        return {
          fieldKey: duplicateNumber ? `${baseKey}__${duplicateNumber + 1}` : baseKey,
          label: labelFor(input),
          inputType: input.type === "select-one" ? "select" : input.type || "text",
          required: input.required || input.getAttribute("aria-required") === "true",
          selectorCandidates: [input.getAttribute("data-testid") && `[data-testid="${input.getAttribute("data-testid")}"]`, input.name && `[name="${CSS.escape(input.name)}"]`, input.id && `#${CSS.escape(input.id)}`].filter(Boolean),
          mapping: { name: input.name || null, id: input.id || null, ariaLabel: input.getAttribute("aria-label") || null, occurrence: duplicateNumber + 1 },
          defaultValue: input.type === "checkbox" ? input.checked : input.value,
          position
        };
      });
  };

  const capture = async (name, categoryLabel) => {
    const fields = getFieldMap();
    if (!name || !categoryLabel) return toast("Enter both a template name and category before saving.", true);

    const captureStartedAt = Date.now();
    toast(`Saving ${fields.length} mapped fields...`);
    try {
      // The background worker writes a durable receipt before and after its
      // database request. Do not rely on a one-time message reply: Chrome can
      // lose that reply while the template itself is already being saved.
      void chrome.runtime.sendMessage({ type: "LK_SAVE_TEMPLATE", payload: { name, categoryLabel, schema: { fields } } }).catch(() => undefined);
      for (let attempt = 0; attempt < 160; attempt += 1) {
        await wait(250);
        const { lastTemplateCapture } = await chrome.storage.local.get(["lastTemplateCapture"]);
        const isCurrentCapture = lastTemplateCapture?.name === name && Number(lastTemplateCapture.at) >= captureStartedAt;
        if (!isCurrentCapture) continue;
        if (lastTemplateCapture.state === "saved") {
          return toast(`Template "${name}" saved (${fields.length} fields mapped). Open the extension popup to verify it.`);
        }
        if (lastTemplateCapture.state === "failed") {
          return toast(`Template was not saved: ${lastTemplateCapture.message || "Unknown extension error."}`, true);
        }
      }
      toast("Template save is still pending. Keep the dashboard server running and check Last capture in the extension popup.");
    } catch {
      toast("Template saving could not start. Reload ListingKing in brave://extensions, then refresh this Meesho page.", true);
    }
  };
  const showTemplateForm = () => {
    const form = document.querySelector("#listingking-panel .lk-template-form");
    if (!form) return;
    form.hidden = false;
    form.querySelector("input[name=templateName]").focus();
  };
  const dryRun = () => {
    const fields = getFieldMap();
    const result = fields.filter(field => field.required).map(field => field.label).join(", ");
    toast(`Dry run: ${fields.length} safe fields detected. Required: ${result || "none"}.`);
  };
  const entryValue = (field, details, item) => {
    const key = `${field.fieldKey || ""} ${field.label || ""} ${field.mapping?.name || ""} ${field.mapping?.id || ""}`.toLowerCase().replace(/[_-]+/g, " ");
    if (/product\s*name/.test(key)) return item.title;
    // Meesho's catalog description textarea is named `comment`, not
    // `description`. Treat both names as the Smart Listing description so the
    // generated, seller-reviewed paragraph reaches the actual catalog field.
    if (/(?:product\s*)?(?:description|comment)\b/.test(key)) return item.description;
    // Meesho renders Net Quantity as a searchable control. It is a template
    // field, so the value captured with this template is authoritative (for
    // example 1 or 12); stale listing-level data must never replace it.
    if (/net\s*quantity|\bmultipack\b/.test(key)) return field.defaultValue ?? details.netQuantity ?? "";
    if (/\bsize\b/.test(key)) return details.size || field.defaultValue || "Free Size";
    if (/\bsku\b/.test(key)) return item.sku;
    if (/\bmrp\b|maximum retail/.test(key)) return item.mrp;
    if (/meesho\s*price|selling\s*price/.test(key)) return item.meeshoPrice;
    if (/wrong|defective|return\s*price/.test(key)) return item.defectivePrice;
    if (/colour|color/.test(key)) return details.color;
    if (/material|fabric/.test(key)) return details.material;
    if (/style|pattern|fit/.test(key)) return details.style;
    if (/audience|gender/.test(key)) return details.audience;
    return field.defaultValue;
  };
  const isPriceTableField = field => /\b(sku|mrp|maximum retail|meesho\s*price|selling\s*price|wrong|defective|return\s*price|inventory|stock)\b/i.test(`${field.fieldKey || ""} ${field.label || ""}`.replace(/[_-]+/g, " "));
  const reviewedEntries = (listing, item) => {
    const details = listing.productDetailsJson && typeof listing.productDetailsJson === "object" ? listing.productDetailsJson : {};
    const fields = Array.isArray(listing.template?.schemaJson?.fields) ? listing.template.schemaJson.fields : [];
    // Price-table controls do not exist until Meesho has applied the size choice.
    // They are filled later through the one rendered table row, never through the
    // captured generic selectors (which can point to a different dynamic input).
    return fields.filter(field => !isPriceTableField(field)).map(field => ({ ...field, value: entryValue(field, details, item) })).filter(field => field.value !== undefined && field.value !== null && field.value !== "" && field.selectorCandidates?.length);
  };
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const visible = element => Boolean(element && element.getClientRects().length);
  const directTextMatch = (element, value) => visible(element) && element.textContent?.trim().toLowerCase() === String(value).trim().toLowerCase();
  const dropdownTriggers = target => [...new Set([
    target,
    target.closest('[role="combobox"], [aria-haspopup="listbox"]'),
    target.parentElement?.querySelector('[role="combobox"], [aria-haspopup="listbox"], button'),
    target.parentElement,
    target.parentElement?.parentElement
  ])].filter(element => visible(element));
  // Do not synthesize a full pointer sequence here. Meesho's MUI menu can handle
  // both pointerdown and click as separate selection toggles, which immediately
  // selects and then clears Free Size. The native browser path is preferred; this
  // one clean click is the safe fallback when native input is unavailable.
  const userClick = element => {
    if (typeof element?.click === "function") return element.click();
    // SVG has no HTMLElement.click(). Meesho's Free Size control is an SVG, so
    // target it directly without redirecting the event to its non-selecting text.
    return element?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  };
  const centerPoint = element => {
    if (!element || !visible(element)) return null;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  };
  const nativePageClick = async (element, { scroll = true } = {}) => {
    // The Net Quantity control is below the fold on many Meesho categories.
    // A debugger click uses viewport coordinates, so make the exact control
    // visible before calculating its centre. A live MUI popover is already in
    // view; scrolling a checkbox or Apply button inside it can dismiss the
    // popover before Chromium clicks it, so callers can opt out of scrolling.
    if (scroll) {
      element?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "auto" });
      await wait(60);
    }
    const point = centerPoint(element);
    if (!point) return { ok: false, message: "The Meesho control was not visible." };
    const hit = document.elementFromPoint(point.x, point.y);
    if (!hit || !(element.contains(hit) || hit.contains(element))) return { ok: false, message: "The Meesho control was covered by another page element." };
    try {
      const result = await backgroundMessage({
        type: "LK_NATIVE_CLICK",
        payload: point
      });
      return result?.ok ? { ok: true } : { ok: false, message: result?.message || "Meesho rejected the click." };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Meesho rejected the click." };
    }
  };
  const nearbyOptionText = input => {
    let node = input.closest("label, [role=option], [role=menuitem]") || input.parentElement;
    for (let level = 0; node && level < 4; level += 1, node = node.parentElement) {
      const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
      if (text.length && text.length < 180) return text.toLowerCase();
    }
    return "";
  };
  const nearestApplyButton = node => {
    let scope = node;
    for (let level = 0; scope && level < 6; level += 1, scope = scope.parentElement) {
      const button = [...scope.querySelectorAll?.('button, [role="button"], [tabindex], div, span') || []]
        .filter(candidate => visible(candidate) && candidate.textContent?.trim().toLowerCase() === "apply" && !candidate.closest("#listingking-panel"))
        .sort((left, right) => (left.textContent?.length || 0) - (right.textContent?.length || 0))[0];
      if (button) return button;
    }
    return [...document.querySelectorAll('button, [role="button"], [tabindex], div, span')]
      .filter(button => visible(button) && button.textContent?.trim().toLowerCase() === "apply" && !button.closest("#listingking-panel"))
      .sort((left, right) => (left.textContent?.length || 0) - (right.textContent?.length || 0))[0] || null;
  };
  const chooseCheckboxOption = async candidate => {
    const matchingCheckbox = [...document.querySelectorAll('input[type="checkbox"], [role="checkbox"]')]
      .find(input => !input.closest("#listingking-panel") && visible(input.closest("label") || input.parentElement || input) && nearbyOptionText(input).includes(candidate.toLowerCase()));
    if (!matchingCheckbox) return false;
    const checked = matchingCheckbox.matches('input') ? matchingCheckbox.checked : matchingCheckbox.getAttribute("aria-checked") === "true";
    if (!checked) userClick(matchingCheckbox);
    await wait(180);
    const apply = nearestApplyButton(matchingCheckbox);
    if (!apply) return false;
    userClick(apply);
    await wait(550);
    return true;
  };
  const entryKey = entry => `${entry.fieldKey || ""} ${entry.label || ""} ${entry.mapping?.name || ""} ${entry.mapping?.id || ""}`.toLowerCase().replace(/[_-]+/g, " ");
  const activeMeeshoMenu = () => [...document.querySelectorAll('ul[role="menu"]')].find(menu => visible(menu) && !menu.closest("#listingking-panel")) || null;
  const visibleMuiMenu = menu => {
    if (!menu?.isConnected || !visible(menu) || menu.closest("#listingking-panel") || menu.closest('[aria-hidden="true"]')) return false;
    const style = window.getComputedStyle(menu);
    const rect = menu.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
  };
  const distanceBetween = (left, right) => {
    const a = left.getBoundingClientRect();
    const b = right.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    return Math.hypot(ax - bx, ay - by);
  };
  const activeMuiMenuForTarget = (target, value) => [...document.querySelectorAll('ul[role="menu"], [role="listbox"]')]
    .filter(menu => visibleMuiMenu(menu) && [...menu.querySelectorAll('[role="option"], [role="menuitem"], button, li, div, span')].some(option => directTextMatch(option, value)))
    .sort((left, right) => distanceBetween(left, target) - distanceBetween(right, target))[0] || null;
  const exactMuiOption = (menu, value) => [...menu.querySelectorAll('[role="option"], [role="menuitem"], button, li, div, span')]
    .filter(option => directTextMatch(option, value))
    .sort((left, right) => (left.children.length || 0) - (right.children.length || 0))[0] || null;
  // HSN, Generic Name, and Shelf Life are ordinary one-choice Meesho menus,
  // but their rendered option text is not always the raw captured value. For
  // example, HSN can render as "3004 - ..." and Shelf Life can use "month"
  // while the form value is "months". Keep this matching logic isolated from
  // the GST, Free Size, and Net Quantity state machines.
  const normaliseCatalogChoice = value => String(value || "")
    .toLowerCase()
    .replace(/months\b/g, "month")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const catalogChoiceMatches = (text, value) => {
    const option = normaliseCatalogChoice(text);
    const expected = normaliseCatalogChoice(value);
    if (!option || !expected) return false;
    // Meesho sometimes adds a description after an HSN code, or renders a
    // plural form such as "Pain Relief Ointments". Match the value without
    // ever looking outside the one menu opened for this target.
    const singular = choice => choice.replace(/\b([a-z]{4,})s\b/g, "$1");
    const optionSingular = singular(option);
    const expectedSingular = singular(expected);
    return option === expected
      || option.startsWith(`${expected} `)
      || option.includes(` ${expected} `)
      || optionSingular === expectedSingular
      || optionSingular.startsWith(`${expectedSingular} `)
      || optionSingular.includes(` ${expectedSingular} `);
  };
  const catalogChoiceMenuForTarget = target => [...document.querySelectorAll('ul[role="menu"], [role="listbox"], [role="dialog"], .MuiPopover-root, .MuiPopper-root')]
    .filter(menu => visibleMuiMenu(menu) && menu.querySelector('input, textarea, [role="option"], [role="menuitem"], button, li, p, span, div'))
    .sort((left, right) => distanceBetween(left, target) - distanceBetween(right, target))[0] || null;
  const catalogChoiceOption = (menu, value) => {
    const candidates = [...menu.querySelectorAll('[role="option"], [role="menuitem"], button, li, p, span, div')]
      .filter(option => visible(option) && catalogChoiceMatches(option.textContent, value))
      .map(option => option.closest('[role="option"], [role="menuitem"], button, li') || option)
      .filter((option, index, items) => items.indexOf(option) === index)
      .sort((left, right) => (left.children.length || 0) - (right.children.length || 0) || (left.textContent?.length || 0) - (right.textContent?.length || 0));
    return candidates[0] || null;
  };
  const catalogChoiceSearchInput = menu => [...menu?.querySelectorAll?.('input, textarea') || []]
    .find(input => visible(input) && !input.readOnly && !input.disabled && !input.closest('#listingking-panel')) || null;
  const setCatalogChoiceSearch = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
    setter?.call(input, String(value));
    // Do not blur: MUI closes an autocomplete popover when its search box loses
    // focus. This deliberately affects only the temporary search input.
    ["input", "change"].forEach(type => input.dispatchEvent(new Event(type, { bubbles: true })));
  };
  const isCatalogChoiceEntry = entry => /(?:\bhsn(?:\s*code)?\b|generic\s*name|maximum\s*shelf\s*life|\bshelf\s*life\b)/.test(entryKey(entry));
  const targetHasCatalogChoice = (target, value) => catalogChoiceMatches(target?.value, value);
  const chooseMeeshoCatalogChoice = async (target, value) => {
    const required = String(value ?? "").trim();
    if (!required) return false;
    if (targetHasCatalogChoice(target, required)) return true;

    const waitForCatalogMenu = async () => {
      let menu = catalogChoiceMenuForTarget(target);
      for (let attempt = 0; attempt < 14 && !menu; attempt += 1) {
        await wait(150);
        menu = catalogChoiceMenuForTarget(target);
      }
      return menu;
    };
    const optionFromMenu = async menu => {
      let option = catalogChoiceOption(menu, required);
      if (option) return option;
      const search = catalogChoiceSearchInput(menu);
      if (!search) return null;
      setCatalogChoiceSearch(search, required);
      for (let attempt = 0; attempt < 10 && !option; attempt += 1) {
        await wait(120);
        option = catalogChoiceOption(menu, required);
      }
      return option;
    };
    const selectOption = async option => {
      // Normal Meesho selects open through their own click handler (the same
      // path used by the working GST field). The option then receives a trusted
      // native click, with one safe fallback on that exact option only.
      await nativePageClick(option, { scroll: false });
      let selected = await waitFor(() => targetHasCatalogChoice(target, required), 12, 150);
      if (!selected) {
        userClick(option);
        selected = await waitFor(() => targetHasCatalogChoice(target, required), 10, 150);
      }
      return selected;
    };

    // This routine is deliberately isolated to HSN, Generic Name, and Shelf
    // Life. It never opens Size, touches the Free Size checkbox, or reuses the
    // GST/Net Quantity selection paths.
    let menu = catalogChoiceMenuForTarget(target);
    for (let pass = 0; pass < 2; pass += 1) {
      if (!menu) {
        userClick(target);
        menu = await waitForCatalogMenu();
      }
      if (!menu) continue;
      const option = await optionFromMenu(menu);
      if (option && await selectOption(option)) return true;
      if (targetHasCatalogChoice(target, required)) return true;
      // Do not click an already-open target again: that would close its MUI
      // popover. A second pass is allowed only after the menu has disappeared.
      menu = catalogChoiceMenuForTarget(target);
      if (menu) return false;
    }
    return targetHasCatalogChoice(target, required);
  };
  const isNetQuantityEntry = entry => /net\s*quantity|\bmultipack\b/.test(entryKey(entry));
  const activeMeeshoNetQuantityMenu = value => [...document.querySelectorAll('ul[role="menu"]')]
    .find(menu => {
      const style = window.getComputedStyle(menu);
      const rect = menu.getBoundingClientRect();
      return menu.isConnected && visible(menu) && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && !menu.closest('[aria-hidden="true"]') && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth && !menu.closest("#listingking-panel") && [...menu.querySelectorAll('[role="menuitem"]')].some(item => directTextMatch(item, value));
    }) || null;
  const netQuantityOption = (menu, value) => [...menu?.querySelectorAll?.('[role="menuitem"]') || []]
    .find(item => directTextMatch(item, value)) || null;
  const activeMeeshoSizeMenu = () => [...document.querySelectorAll('ul[role="menu"]')]
    .find(menu => {
      const style = window.getComputedStyle(menu);
      const rect = menu.getBoundingClientRect();
      return menu.isConnected && visible(menu) && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && !menu.closest('[aria-hidden="true"]') && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth && !menu.closest("#listingking-panel") && /free\s*size/i.test(menu.textContent || "") && /apply/i.test(menu.textContent || "");
    }) || null;
  const freeSizeChoice = menu => {
    const label = [...menu.querySelectorAll("p, span, div, li")]
      .filter(element => directTextMatch(element, "Free Size"))
      .sort((left, right) => (left.children.length || 0) - (right.children.length || 0))[0] || null;
    if (!label) return null;
    // Locate the smallest ancestor whose own text is exactly "Free Size".
    // This avoids selecting a decorative SVG from the larger menu container.
    const ancestors = [];
    for (let node = label; node && node !== menu; node = node.parentElement) ancestors.push(node);
    const row = ancestors.find(node => node.textContent?.replace(/\s+/g, " ").trim().toLowerCase() === "free size" && node.querySelector("input[type=checkbox], [role=checkbox], svg")) || label.parentElement;
    // Different Meesho releases expose this as either a native/ARIA checkbox
    // or a custom SVG. Prefer the semantic control, then use the SVG fallback
    // verified on the supplier panel.
    const toggle = row?.querySelector('input[type="checkbox"], [role="checkbox"], svg') || null;
    return { label, row, toggle };
  };
  const freeSizeChecked = choice => {
    const toggle = choice?.toggle;
    if (!toggle) return false;
    if (toggle.matches?.('input[type="checkbox"]')) return Boolean(toggle.checked);
    if (toggle.getAttribute?.("role") === "checkbox") return toggle.getAttribute("aria-checked") === "true" || toggle.dataset?.state === "checked";
    if (toggle.getAttribute?.("aria-checked") === "true" || toggle.dataset?.state === "checked") return true;
    // On Meesho's custom SVG, the unchecked square is a stroked rect while a
    // selected size renders a coloured path. This remains the final fallback.
    return Boolean(toggle.querySelector?.("path[fill]:not([fill='none'])"));
  };
  const priceFieldsAvailable = () => ["meesho_price", "only_wrong_return_price", "product_mrp", "inventory", "supplier_sku_id"]
    .every(id => Boolean(document.getElementById(id)));
  const waitFor = async (condition, attempts, delay) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (condition()) return true;
      await wait(delay);
    }
    return condition();
  };
  const chooseMeeshoFreeSize = async target => {
    lastSizeFailure = "";
    const selected = () => target.value?.trim().toLowerCase() === "free size";
    let menu = activeMeeshoSizeMenu();
    if (!menu) {
      // Open Size exactly once. Re-clicking a MUI trigger toggles its popover off.
      userClick(target);
      for (let attempt = 0; attempt < 10 && !menu; attempt += 1) {
        await wait(250);
        menu = activeMeeshoSizeMenu();
      }
    }
    if (!menu) {
      lastSizeFailure = "Size menu did not open after one click.";
      return false;
    }
    let choice = freeSizeChoice(menu);
    if (!choice?.toggle) {
      lastSizeFailure = "Meesho opened Size, but Free Size or Apply was not found in that menu.";
      return false;
    }
    // Let the freshly-opened MUI popover finish its layout before calculating
    // a trusted pointer location. We never click Size again in this function.
    await wait(280);
    choice = freeSizeChoice(activeMeeshoSizeMenu() || menu) || choice;
    if (!choice?.toggle) {
      lastSizeFailure = "Meesho opened Size, but the Free Size checkbox was not ready.";
      return false;
    }
    // State machine: open Size once, tap the actual checkbox control, verify
    // its blue checkmark, then click Apply. A single controlled retry targets
    // the same live checkbox only; it never reopens or closes the Size menu.
    let toggleResult = { ok: true };
    if (!freeSizeChecked(choice)) {
      // The SVG—not the Free Size text—is the live selectable control. The
      // background uses Input.synthesizeTapGesture to produce one trusted tap.
      let checked = await waitFor(() => {
        const liveMenu = activeMeeshoSizeMenu();
        const liveChoice = liveMenu && freeSizeChoice(liveMenu);
        return freeSizeChecked(liveChoice);
      }, 0, 0);
      if (!checked) toggleResult = await nativePageClick(choice.toggle, { scroll: false });
      checked = await waitFor(() => {
        const liveMenu = activeMeeshoSizeMenu();
        const liveChoice = liveMenu && freeSizeChoice(liveMenu);
        return freeSizeChecked(liveChoice);
      }, 8, 150);
      if (!checked) {
        const liveMenu = activeMeeshoSizeMenu();
        const liveChoice = liveMenu && freeSizeChoice(liveMenu);
        if (liveChoice?.toggle) toggleResult = await nativePageClick(liveChoice.toggle, { scroll: false });
      }
      checked = await waitFor(() => {
        const liveMenu = activeMeeshoSizeMenu();
        const liveChoice = liveMenu && freeSizeChoice(liveMenu);
        return freeSizeChecked(liveChoice);
      }, 8, 150);
      if (!checked) {
        lastSizeFailure = `Meesho did not tick Free Size.${toggleResult.ok ? " ListingKing stopped before Apply because no blue checkmark appeared." : ` Native click error: ${toggleResult.message}`}`;
        return false;
      }
    }
    menu = activeMeeshoSizeMenu() || menu;
    choice = freeSizeChoice(menu) || choice;
    const apply = [...menu.querySelectorAll("button")]
      .find(button => visible(button) && button.textContent?.trim().toLowerCase() === "apply");
    if (!apply) {
      lastSizeFailure = "Free Size was ticked, but Meesho's Apply button was not visible.";
      return false;
    }
    await wait(150);
    const applyResult = await nativePageClick(apply, { scroll: false });
    let applied = await waitFor(() => selected() && priceFieldsAvailable(), 14, 200);
    if (!applied) {
      // Only fall back after the Size value has stayed unchanged. This cannot
      // re-open the picker and avoids the old repeated open/close loop.
      userClick(apply);
      applied = await waitFor(() => selected() && priceFieldsAvailable(), 10, 200);
    }
    if (applied) return true;
    lastSizeFailure = `Free Size was ticked, but Meesho did not apply it.${applyResult.ok ? " The trusted Apply click did not create the price row." : ` Native click error: ${applyResult.message}`}`;
    return false;
  };
  const chooseMeeshoNetQuantity = async (target, value) => {
    const required = String(value ?? "").trim();
    if (!required) return false;
    if (target.value?.trim() === required) return true;
    const waitForMenu = async () => {
      let menu = activeMeeshoNetQuantityMenu(required);
      for (let attempt = 0; attempt < 12 && !menu; attempt += 1) {
        await wait(150);
        menu = activeMeeshoNetQuantityMenu(required);
      }
      return menu;
    };
    const selectFromOpenMenu = async menu => {
      const option = netQuantityOption(menu, required);
      if (!option) return false;
      await nativePageClick(option);
      return waitFor(() => target.value?.trim() === required, 14, 150);
    };

    // This is deliberately a two-step state machine, never the generic
    // dropdown loop. The first pass opens exactly once and chooses the exact
    // menu item. If Meesho closes the menu without changing the value (the old
    // 1 -> 100 failure), one controlled repair reopens it and clicks only the
    // requested value. No parent trigger or substring matching is allowed.
    let menu = activeMeeshoNetQuantityMenu(required);
    if (!menu) {
      await nativePageClick(target);
      menu = await waitForMenu();
    }
    if (menu && await selectFromOpenMenu(menu)) return true;

    if (target.value?.trim() === required) return true;
    menu = activeMeeshoNetQuantityMenu(required);
    if (!menu) {
      await nativePageClick(target);
      menu = await waitForMenu();
    }
    if (menu && await selectFromOpenMenu(menu)) return true;
    return target.value?.trim() === required;
  };
  const chooseDropdownValue = async (target, value, entry) => {
    if (target.tagName === "SELECT") {
      target.value = String(value);
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    // These three dropdowns have display labels which can differ slightly from
    // their saved form values. Route only them through their dedicated picker;
    // the stable GST, Free Size, and Net Quantity routines remain unchanged.
    if (isCatalogChoiceEntry(entry || {})) return chooseMeeshoCatalogChoice(target, value);
    const values = (Array.isArray(value) ? value : [value]).map(candidate => String(candidate).trim()).filter(Boolean);
    for (const candidate of values) {
      if (/\bsize\b/.test(entryKey(entry || {})) && candidate.toLowerCase() === "free size") {
        // Size has a different MUI workflow from ordinary dropdowns. Never fall
        // through to the generic routine: it would re-open and close this menu
        // repeatedly when the dedicated Free Size action has already run.
        return chooseMeeshoFreeSize(target);
      }
      if (target.value?.trim().toLowerCase() === candidate.toLowerCase()) return true;

      // A MUI menu can remain mounted briefly after Net Quantity closes. Never
      // search the whole document for an option such as "5": that can change
      // #multipack instead of the GST control. Scope each choice to the one
      // visible menu nearest this exact target.
      const chooseFromTargetMenu = async () => {
        let menu = activeMuiMenuForTarget(target, candidate);
        for (let attempt = 0; attempt < 10 && !menu; attempt += 1) {
          await wait(150);
          menu = activeMuiMenuForTarget(target, candidate);
        }
        const option = menu && exactMuiOption(menu, candidate);
        if (!option) return false;
        const click = await nativePageClick(option, { scroll: false });
        if (!click.ok) return false;
        return waitFor(() => target.value?.trim().toLowerCase() === candidate.toLowerCase(), 10, 150);
      };

      userClick(target);
      if (await chooseFromTargetMenu()) return true;
      // One recovery click is allowed for this same control only. It cannot
      // touch the former Net Quantity menu or toggle the Size workflow.
      if (target.value?.trim().toLowerCase() === candidate.toLowerCase()) return true;
      userClick(target);
      if (await chooseFromTargetMenu()) return true;
    }
    return false;
  };
  const isDropdown = (target, entry) => {
    const key = `${entry.fieldKey || ""} ${entry.label || ""}`.toLowerCase().replace(/[_-]+/g, " ");
    return target.tagName === "SELECT" || entry.inputType === "select" || target.getAttribute("role") === "combobox" || target.readOnly || /\b(size|gst|hsn|capacity|generic name|shelf life|net quantity|country of origin|brand)\b/.test(key);
  };
  const targetForEntry = entry => {
    const key = entryKey(entry);
    // Generated mui-* IDs in a captured template change on every Meesho page load.
    // Use the live, stable controls before trying those old selectors.
    if (/\bsize\b/.test(key)) {
      const size = [...document.querySelectorAll('input[placeholder="Select"][readonly]')]
        .find(input => !input.name && visible(input));
      if (size) return size;
    }
    if (/net\s*quantity|\bmultipack\b/.test(key)) {
      const quantity = document.querySelector('#multipack, input[name="multipack"]');
      if (quantity && visible(quantity)) return quantity;
    }
    for (const selector of entry.selectorCandidates || []) {
      try {
        const matches = [...document.querySelectorAll(selector)].filter(visible);
        if (!matches.length) continue;
        const occurrence = Math.max(0, Number(entry.mapping?.occurrence || 1) - 1);
        return matches[occurrence] || matches[0];
      } catch { /* A changed Meesho selector is safely skipped. */ }
    }
    return null;
  };
  const meeshoSizeControl = () => [...document.querySelectorAll('input[placeholder="Select"][readonly]')]
    .find(input => !input.name && visible(input)) || null;
  const ensureMeeshoSize = async value => {
    const target = meeshoSizeControl();
    if (!target) return false;
    const required = String(value || "Free Size").trim();
    if (target.value?.trim().toLowerCase() === required.toLowerCase() && priceRow().length) return true;
    if (required.toLowerCase() === "free size") return chooseMeeshoFreeSize(target);
    return chooseDropdownValue(target, required, { fieldKey: "size", label: "Size" });
  };
  const priceRow = () => {
    const rows = [...document.querySelectorAll("tr, [role=row], div")].map(element => ({ element, inputs: [...element.querySelectorAll("input")].filter(input => input.type !== "checkbox" && !input.readOnly && visible(input)) }));
    return rows
      .filter(row => row.inputs.length >= 4 && row.inputs.length <= 6 && (/free\s*size/i.test(row.element.textContent || "") || /delete/i.test(row.element.textContent || "")))
      .sort((left, right) => (left.element.textContent?.length || 0) - (right.element.textContent?.length || 0))[0]?.inputs || [];
  };
  const fillPriceAndSkuRow = async item => {
    const directInputs = ["meesho_price", "only_wrong_return_price", "product_mrp", "inventory", "supplier_sku_id"]
      .map(id => document.getElementById(id))
      .filter(input => input && visible(input));
    let inputs = directInputs;
    for (let attempt = 0; attempt < 10 && !inputs.length; attempt += 1) {
      await wait(350);
      inputs = ["meesho_price", "only_wrong_return_price", "product_mrp", "inventory", "supplier_sku_id"]
        .map(id => document.getElementById(id))
        .filter(input => input && visible(input));
      if (!inputs.length) inputs = priceRow();
    }
    if (!inputs.length) return { count: 0, message: "Meesho's price row has not appeared yet. Select Size and press Apply, then retry filling." };
    const values = [item.meeshoPrice, item.defectivePrice, item.mrp, item.validationJson?.inventory || 1, item.sku];
    let count = 0;
    for (let index = 0; index < Math.min(inputs.length, values.length); index += 1) {
      if (values[index] === null || values[index] === undefined || values[index] === "") continue;
      nativeSet(inputs[index], String(values[index]));
      count += 1;
      await wait(80);
    }
    return { count };
  };
  const fileFromStoredImage = (result, image, index) => {
    if (typeof result?.base64 !== "string" || !result.base64) throw new Error("ListingKing received no image data from storage.");
    let binary;
    try { binary = atob(result.base64); } catch { throw new Error("ListingKing received invalid image data from storage."); }
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (!bytes.length || (Number(result.byteLength) && bytes.length !== Number(result.byteLength))) throw new Error("ListingKing could not verify the stored image bytes.");
    const contentType = String(result.contentType || "image/jpeg").split(";", 1)[0].toLowerCase();
    if (!/^image\/(jpeg|png)$/.test(contentType)) throw new Error(`Meesho's Add Images control accepts JPEG or PNG, not ${contentType || "this image type"}.`);
    const extension = contentType === "image/png" ? "png" : "jpg";
    return new File([bytes], `${image.role.toLowerCase()}-${index + 1}.${extension}`, { type: contentType });
  };
  const uploadedImagePreviewCount = uploader => uploader.parentElement?.querySelectorAll("img").length || 0;
  const attachStoredImages = async item => {
    const roleOrder = { FRONT: 0, SIDE: 1, DETAIL: 2, BACK: 3 };
    const images = [...(item.images || [])].sort((left, right) => (roleOrder[left.role] ?? 9) - (roleOrder[right.role] ?? 9));
    if (!images.length) return { attached: 0, skipped: 0 };
    // Preserve the seller's required first image. This is the exact Meesho
    // "Add Images" input, so ListingKing adds further stored images rather than
    // replacing the front image via #changeFrontImage or #getFile.
    const uploader = document.querySelector('#addMoreImagesInput[data-testid="addMoreImagesInput"]');
    if (!uploader || uploader.disabled) return { attached: 0, skipped: images.length, message: "Meesho's Add Images control was not found. Add the catalog's required front image, then retry." };
    const beforePreviews = uploadedImagePreviewCount(uploader);
    try {
      const files = [];
      for (let index = 0; index < images.length; index += 1) {
        const result = await backgroundMessage({ type: "LK_GET_LISTING_IMAGE", imageId: images[index].id });
        if (!result?.ok) throw new Error(result?.message || "Stored image could not be loaded.");
        files.push(fileFromStoredImage(result, images[index], index));
      }
      const transfer = new DataTransfer();
      files.forEach(file => transfer.items.add(file));
      uploader.files = transfer.files;
      if (uploader.files.length !== files.length) throw new Error("The browser did not accept the stored image files.");
      ["input", "change", "blur"].forEach(type => uploader.dispatchEvent(new Event(type, { bubbles: true, composed: true })));
      uploader.style.outline = "2px solid #d8f24f";
      const previewAdded = await waitFor(() => uploadedImagePreviewCount(uploader) > beforePreviews, 32, 250);
      if (!previewAdded) return { attached: 0, skipped: images.length, message: `ListingKing sent ${files.length} stored image file${files.length === 1 ? "" : "s"}, but Meesho did not show a new uploaded-image preview.` };
      return { attached: files.length, skipped: 0 };
    } catch (error) {
      return { attached: 0, skipped: images.length, message: error instanceof Error ? error.message : "Stored image could not be attached." };
    }
  };
  const fill = async () => {
    stopped = false;
    toast("Loading your Ready ListingKing listing...");
    let result;
    try { result = await backgroundMessage({ type: "LK_GET_READY_LISTINGS" }); } catch (error) { return toast(error instanceof Error ? error.message : "Could not contact the ListingKing extension. Reload it in brave://extensions, then refresh this Meesho page.", true); }
    if (!result?.ok) return toast(result?.message || "Ready listings could not be loaded.", true);
    readyListings = result.listings || [];
    const available = readyListings.filter(listing => listing.template?.status === "ACTIVE" && listing.items?.length);
    if (!available.length) return toast("No Ready listing found. Finish Review and click Save smart listing in ListingKing first.", true);
    const listing = available.find(candidate => candidate.id === selectedListingId) || available[0];
    const item = listing.items[0];
    renderReadyListings();
    if (item.status === "FILLING") return toast(`Product ${item.position} is already in progress. Use Retry product fill if you did not save it on Meesho, or Confirm product ${item.position} saved after saving it.`, true);
    if (item.status !== "READY") return toast(`Product ${item.position} is not available to fill. Reload listings and select another Ready product.`, true);
    // Size is a mandatory Meesho workflow step. Do not let an old captured
    // mui-* selector decide whether it runs: it must run even if the template
    // was captured before this control existed or has changed IDs.
    const details = listing.productDetailsJson && typeof listing.productDetailsJson === "object" ? listing.productDetailsJson : {};
    const sizeValue = details.size || "Free Size";
    const entries = reviewedEntries(listing, item).filter(entry => !/\bsize\b/.test(entryKey(entry)));
    if (!entries.length) return toast("This template has no safe mapped fields available on this Meesho page. Click Refresh map and capture the template again.", true);
    const imageCount = item.images?.length || 0;
    if (!confirm(`Review: ListingKing will fill ${entries.length} mapped fields and attach up to ${imageCount} stored image${imageCount === 1 ? "" : "s"} for item ${item.position} (${item.title}). It will never submit the catalog. Continue?`)) return toast("Filling cancelled. Nothing changed.");
    const tracking = await backgroundMessage({ type: "LK_UPDATE_ITEM_STATUS", itemId: item.id, status: "FILLING" });
    if (!tracking?.ok) return toast(tracking?.message || "This item could not be marked as filling.", true);
    const sizeSelected = await ensureMeeshoSize(sizeValue);
    const results = [{ field: "Size", status: sizeSelected ? "filled" : "needs_selection" }];
    if (!sizeSelected) {
      // Do not keep filling other controls after Meesho rejected Size. Those
      // later dropdown clicks close the Size popup and leave a misleading,
      // partly-filled page. Restore this item to Ready so Retry can start
      // cleanly without the seller having to edit anything manually.
      const reset = await backgroundMessage({ type: "LK_UPDATE_ITEM_STATUS", itemId: item.id, status: "READY" });
      item.status = reset?.ok ? "READY" : "FILLING";
      renderReadyListings();
      chrome.runtime.sendMessage({ type: "LK_AUDIT", payload: { status: "PARTIAL", fields: results } });
      return toast(`Fill stopped before changing the remaining fields. ${lastSizeFailure || "Meesho did not apply the selected Size."} Try Fill product ${item.position} again.`, true);
    }

    // Net Quantity is a required Meesho selector and must use the value stored
    // in this captured template (for example 1 or 12). Handle it immediately
    // after Size, before any other field can move or close its menu.
    const netQuantityEntries = entries.filter(isNetQuantityEntry);
    for (const entry of netQuantityEntries) {
      const target = targetForEntry(entry);
      const selected = Boolean(target && await chooseMeeshoNetQuantity(target, entry.value));
      results.push({ field: entry.label || "Net Quantity", status: selected ? "filled" : "needs_selection" });
      if (!selected) {
        const reset = await backgroundMessage({ type: "LK_UPDATE_ITEM_STATUS", itemId: item.id, status: "READY" });
        item.status = reset?.ok ? "READY" : "FILLING";
        renderReadyListings();
        chrome.runtime.sendMessage({ type: "LK_AUDIT", payload: { status: "PARTIAL", fields: results } });
        return toast(`Fill stopped before changing the remaining fields. Net Quantity must be ${entry.value}; Meesho kept ${target?.value || "no value"}. Try Fill product ${item.position} again.`, true);
      }
    }

    for (const entry of entries.filter(entry => !isNetQuantityEntry(entry))) {
      if (stopped) break;
      const target = targetForEntry(entry);
      if (!target || isSensitive(target)) { results.push({ field: entry.label, status: "skipped" }); continue; }
      if (isDropdown(target, entry)) {
        const selected = await chooseDropdownValue(target, entry.value, entry);
        if (!selected) { results.push({ field: entry.label, status: "needs_selection" }); continue; }
      }
      else if (target.type === "checkbox") { target.checked = Boolean(entry.value); target.dispatchEvent(new Event("change", { bubbles: true })); }
      else nativeSet(target, String(entry.value ?? ""));
      results.push({ field: entry.label, status: "filled" });
    }
    const priceResult = stopped ? { count: 0 } : await fillPriceAndSkuRow(item);
    const images = stopped ? { attached: 0, skipped: 0 } : await attachStoredImages(item);
    chrome.runtime.sendMessage({ type: "LK_AUDIT", payload: { status: stopped ? "PARTIAL" : "SUCCESS", fields: results.map(result => ({ ...result, value: undefined })) } });
    const imageStatus = images.message ? ` ${images.message}` : images.attached ? ` ${images.attached} stored image${images.attached === 1 ? "" : "s"} attached.` : "";
    item.status = "FILLING";
    renderReadyListings();
    const selectionStatus = results.filter(result => result.status === "needs_selection").map(result => result.field);
    const extraStatus = [priceResult.message, lastSizeFailure, selectionStatus.length ? `Choose ${selectionStatus.join(", ")} manually, then retry.` : ""].filter(Boolean).join(" ");
    toast(stopped ? "Stopped by seller. Existing changes remain visible for review." : `Fill finished: ${results.filter(result => result.status === "filled").length + priceResult.count} fields updated.${imageStatus}${extraStatus ? ` ${extraStatus}` : ""} Review before submitting.`);
  };

  const panel = document.createElement("section");
  panel.id = "listingking-panel";
  panel.innerHTML = `<style>#listingking-panel{position:fixed;right:20px;bottom:22px;z-index:2147483647;width:322px;background:#122029;color:#fff;border-radius:12px;box-shadow:0 16px 50px #0005;padding:15px;font:12px Arial,sans-serif}#listingking-panel header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;font-size:14px;font-weight:700}#listingking-panel .mark{color:#d8f24f}#listingking-panel button{border:0;border-radius:6px;padding:9px 7px;font-weight:700;cursor:pointer;margin:3px;width:calc(50% - 8px)}#listingking-panel .fill{width:calc(100% - 6px);background:#d8f24f;color:#122029;margin-top:9px}#listingking-panel .plain{background:#243941;color:#fff}#listingking-panel .stop{width:calc(100% - 6px);background:#f17b58;color:#fff}#listingking-panel .lk-status{display:block;background:#fff;color:#34745b;border-radius:5px;padding:8px;margin-top:8px;line-height:1.35}#listingking-panel .lk-smart{background:#1b3038;border:1px solid #38515a;border-radius:8px;padding:10px}#listingking-panel .lk-smart strong,#listingking-panel .lk-smart small{display:block}#listingking-panel .lk-smart small{color:#b7c5c8;margin-top:3px;line-height:1.3}#listingking-panel .lk-smart select{width:100%;box-sizing:border-box;margin-top:9px;padding:8px;border-radius:5px;border:1px solid #65777c;background:#fff;color:#122029;font:12px Arial}#listingking-panel .lk-template-form{margin-top:10px;padding:10px;background:#243941;border-radius:7px}#listingking-panel .lk-template-form label{display:block;font-size:10px;font-weight:700;margin:0 0 7px}#listingking-panel .lk-template-form input{display:block;width:100%;box-sizing:border-box;margin-top:4px;border:1px solid #66767c;border-radius:5px;padding:7px;background:#fff;color:#122029;font:12px Arial,sans-serif}#listingking-panel .lk-template-form .save-template{width:100%;margin:7px 0 0;background:#d8f24f;color:#122029}</style><header><span><span class="mark">◆</span> ListingKing</span><small>v0.1.34 · Meesho only</small></header><section class="lk-smart"><strong>Smart listing</strong><small class="lk-listing-summary">Loading your Ready listings…</small><select class="lk-listing-select" aria-label="Ready Smart Listing" disabled><option>Loading…</option></select><button class="fill" data-action="fill">Fill product 1</button></section><button class="plain" data-action="capture">Capture template</button><button class="plain" data-action="dry">Check page fields</button><button class="plain" data-action="refresh">Reload listings</button><button class="stop" data-action="stop">Stop filling</button><form class="lk-template-form" hidden><label>Template name<input name="templateName" maxlength="100" placeholder="Example: Japanese balm - free size" required></label><label>Meesho category<input name="categoryLabel" maxlength="100" placeholder="Example: Pain relief balm" required></label><button class="save-template" type="submit">Save this template</button></form><span class="lk-status">Connect the extension, then select a Ready listing.</span>`;
  panel.addEventListener("click", event => {
    const action = event.target.dataset.action;
    if (action === "capture") showTemplateForm();
    if (action === "dry") dryRun();
    if (action === "refresh") void loadReadyListings();
    if (action === "fill") void fill();
    if (action === "complete") void completeItem();
    if (action === "retry") void retryItem();
    if (action === "stop") { stopped = true; toast("Stop requested."); }
  });
  panel.querySelector(".lk-template-form").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = form.elements.templateName.value.trim();
    const categoryLabel = form.elements.categoryLabel.value.trim();
    if (!name || !categoryLabel) return toast("Enter both a template name and category before saving.", true);
    form.hidden = true;
    capture(name, categoryLabel);
  });
  document.body.appendChild(panel);
  panel.querySelector("header small").textContent = "v0.1.36 · Meesho only";
  const listingSelect = panel.querySelector(".lk-listing-select");
  const listingSummary = panel.querySelector(".lk-listing-summary");
  const fillButton = panel.querySelector(".fill");
  fillButton.disabled = true;
  const retryButton = document.createElement("button");
  retryButton.type = "button";
  retryButton.className = "plain";
  retryButton.dataset.action = "retry";
  retryButton.textContent = "Retry product fill";
  retryButton.hidden = true;
  panel.querySelector(".lk-smart").append(retryButton);
  const renderReadyListings = () => {
    const available = readyListings.filter(listing => listing.template?.status === "ACTIVE" && listing.items?.length);
    listingSelect.replaceChildren();
    if (!available.length) {
      listingSelect.disabled = true;
      listingSelect.append(new Option("No Ready listing", ""));
      listingSummary.textContent = "Save a reviewed listing in ListingKing first.";
      return available;
    }
    if (!available.some(listing => listing.id === selectedListingId)) selectedListingId = available[0].id;
    for (const listing of available) listingSelect.append(new Option(`${listing.name} · ${listing.items.length} item${listing.items.length === 1 ? "" : "s"}`, listing.id, false, listing.id === selectedListingId));
    listingSelect.disabled = false;
    const selected = available.find(listing => listing.id === selectedListingId) || available[0];
    listingSummary.textContent = `${selected.template.name} · next: Product ${selected.items[0].position} of ${selected.listingCount}`;
    const activeItem = selected.items[0];
    fillButton.dataset.action = activeItem.status === "FILLING" ? "complete" : "fill";
    fillButton.textContent = activeItem.status === "FILLING" ? `Confirm product ${activeItem.position} saved` : `Fill product ${activeItem.position}`;
    fillButton.disabled = false;
    retryButton.hidden = activeItem.status !== "FILLING";
    return available;
  };
  const loadReadyListings = async () => {
    toast("Loading your Ready ListingKing listings...");
    let result;
    try { result = await backgroundMessage({ type: "LK_GET_READY_LISTINGS" }); } catch (error) { toast(error instanceof Error ? error.message : "Could not contact the ListingKing extension. Reload it in brave://extensions, then refresh this Meesho page.", true); return null; }
    if (!result?.ok) { toast(result?.message || "Ready listings could not be loaded.", true); return null; }
    readyListings = result.listings || [];
    const available = renderReadyListings();
    toast(available.length ? `${available.length} Ready listing${available.length === 1 ? "" : "s"} loaded. Review before filling.` : "No Ready listings yet.");
    return available;
  };
  const completeItem = async () => {
    const listing = readyListings.find(candidate => candidate.id === selectedListingId);
    const item = listing?.items?.[0];
    if (!item || item.status !== "FILLING") return toast("No filled product is awaiting confirmation.", true);
    if (!confirm(`Confirm that you clicked Meesho's Save and Go Back for Product ${item.position}. ListingKing will then unlock the next product.`)) return;
    const result = await backgroundMessage({ type: "LK_UPDATE_ITEM_STATUS", itemId: item.id, status: "FILLED" });
    if (!result?.ok) return toast(result?.message || "This product could not be confirmed.", true);
    toast(`Product ${item.position} confirmed. Loading the next product…`);
    await loadReadyListings();
  };
  const retryItem = async () => {
    const listing = readyListings.find(candidate => candidate.id === selectedListingId);
    const item = listing?.items?.[0];
    if (!item || item.status !== "FILLING") return toast("No in-progress product is available to retry.", true);
    if (!confirm(`Reset Product ${item.position} for a retry? Do this only when you did not click Meesho's Save and Go Back.`)) return;
    const result = await backgroundMessage({ type: "LK_UPDATE_ITEM_STATUS", itemId: item.id, status: "READY" });
    if (!result?.ok) return toast(result?.message || "This product could not be reset.", true);
    toast(`Product ${item.position} reset. You can fill it again.`);
    await loadReadyListings();
  };
  listingSelect.addEventListener("change", event => { selectedListingId = event.target.value; renderReadyListings(); });
  void loadReadyListings();
})();
