"use client";

import { ChangeEvent, Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import reviewStyles from "./review.module.css";

type Details = { productName: string; category: string; material: string; color: string; style: string; features: string; audience: string; keywords: string; notes: string; skuCode: string };
type SavedTemplate = { id: string; name: string; categoryLabel: string; version: number };
type ImageRole = "front" | "side" | "detail" | "back";
type SelectedImage = { id: string; file: File; url: string; uploading?: boolean; stored?: boolean; databaseId?: string };

const initial: Details = { productName: "", category: "", material: "", color: "", style: "", features: "", audience: "", keywords: "", notes: "", skuCode: "" };
const stages = ["Set up", "Images", "Content & prices", "SKU IDs", "Review"];

/**
 * Route handlers normally return JSON, but a proxy or an unhandled server
 * exception can still produce an empty response.  Do not let an empty body
 * hide the real HTTP error behind "Unexpected end of JSON input".
 */
async function readApiJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function apiMessage(response: Response, body: unknown, fallback: string) {
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string" && body.message.trim()) return body.message;
  return response.ok ? fallback : `${fallback} (HTTP ${response.status}).`;
}

export function Dashboard() {
  const [step, setStep] = useState(0);
  const [count, setCount] = useState(5);
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [details, setDetails] = useState<Details>(initial);
  const [images, setImages] = useState<Record<ImageRole, SelectedImage[]>>({ front: [], side: [], detail: [], back: [] });
  const [notice, setNotice] = useState("");
  const [listingId, setListingId] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);
  const [makingReady, setMakingReady] = useState(false);
  const [ready, setReady] = useState(false);

  const selectedTemplate = templates.find(template => template.id === templateId);
  const setupComplete = Boolean(templateId) && details.productName.trim().length >= 2 && details.features.trim().length >= 3 && /^\d+$/.test(details.skuCode.trim()) && Number(details.skuCode) >= 1;
  const setupRequirement = !templateId
    ? "Choose a saved Meesho template before continuing."
    : "Complete the required Product name, Key features, and SKU Code fields (marked *).";
  const storedFrontImageCount = images.front.filter(image => image.stored).length;
  const imageStepComplete = storedFrontImageCount >= count;
  const imageRequirement = `Upload and store ${Math.max(0, count - storedFrontImageCount)} more front image${count - storedFrontImageCount === 1 ? "" : "s"} to continue.`;

  const loadTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const response = await fetch("/api/templates", { cache: "no-store" });
      const body = await readApiJson<SavedTemplate[]>(response);
      if (!response.ok || !body) throw new Error(apiMessage(response, body, "Your saved templates could not be loaded."));
      setTemplates(body);
      setTemplateId(current => body.some((template: SavedTemplate) => template.id === current) ? current : body[0]?.id || "");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Your saved templates could not be loaded.");
    } finally {
      setTemplatesLoading(false);
    }
  };

  useEffect(() => { void loadTemplates(); }, []);

  const update = (key: keyof Details, value: string) => setDetails(current => ({ ...current, [key]: value }));
  const saveReady = async () => {
    if (!listingId) return;
    setMakingReady(true);
    try {
      const response = await fetch(`/api/smart-listings/${listingId}/ready`, { method: "POST" });
      const body = await readApiJson<{ message?: string }>(response);
      if (!response.ok || !body) throw new Error(apiMessage(response, body, "The Smart Listing could not be made Ready."));
      setReady(true);
      setNotice(body.message || "Smart Listing is Ready for the ListingKing extension.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Smart Listing could not be made Ready.");
    } finally {
      setMakingReady(false);
    }
  };
  const next = async () => {
    if (step === 0 && !setupComplete) {
      setNotice(setupRequirement);
      return;
    }
    if (step === 0 && !listingId) {
      setSavingDraft(true);
      try {
        const response = await fetch("/api/smart-listings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId, name: `${details.productName} batch`, listingCount: count, productDetails: details }) });
        const body = await readApiJson<{ id: string; message?: string }>(response);
        if (!response.ok || !body?.id) throw new Error(apiMessage(response, body, "The Smart Listing draft could not be created. Complete all product details first."));
        setListingId(body.id);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "The Smart Listing draft could not be created.");
        return;
      } finally {
        setSavingDraft(false);
      }
    }
    if (step === 0 && listingId) {
      setSavingDraft(true);
      try {
        const response = await fetch(`/api/smart-listings/${listingId}/count`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingCount: count }),
        });
        const body = await readApiJson<{ listingCount: number; message?: string }>(response);
        if (!response.ok || !body) throw new Error(apiMessage(response, body, "Catalog item count could not be updated."));
        setCount(body.listingCount);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Catalog item count could not be updated.");
        return;
      } finally {
        setSavingDraft(false);
      }
    }
    const storedFronts = images.front.filter(image => image.stored).length;
    if (step === 1 && storedFronts < count) {
      setNotice(`Store ${count - storedFronts} more front image${count - storedFronts === 1 ? "" : "s"} before continuing.`);
      return;
    }
    if (step === 2) {
      try {
        const response = await fetch(`/api/smart-listings/${listingId}`, { cache: "no-store" });
        const body = await readApiJson<{ items?: ListingContentItem[] }>(response);
        const invalid = !response.ok || !body || body.items?.some((item: ListingContentItem) => !item.title || !item.description || !item.mrp || !item.meeshoPrice || !item.validationJson?.inventory || Number(item.meeshoPrice) > Number(item.mrp) || (item.defectivePrice !== null && Number(item.defectivePrice) > Number(item.meeshoPrice)));
        if (invalid) {
          setNotice("Save every title, description, MRP, Meesho price, and inventory value first. Wrong / defective return price is optional; if added, it must not exceed selling price.");
          return;
        }
      } catch {
        setNotice("Content could not be verified. Save content and prices before continuing.");
        return;
      }
    }
    setNotice("");
    setStep(current => Math.min(4, current + 1));
  };

  return <main className="shell">
    <aside className="sidebar">
      <a className="brand" href="#"><span className="brand-mark">K</span> ListingKing</a>
      <div className="workspace">WORKSPACE</div>
      {["Overview", "Templates", "Smart listings", "Extension guide", "Settings"].map((item, index) => <button key={item} className={`nav-item ${item === "Smart listings" ? "active" : ""}`} onClick={() => item === "Smart listings" && setStep(0)}><span>{["⌂", "▱", "✦", "◌", "⚙"][index]}</span>{item}</button>)}
      <div className="seller"><span className="avatar">K</span><div><strong>Your seller workspace</strong><button className="signout" onClick={() => signOut({ callbackUrl: "/sign-in" })}>Sign out</button></div></div>
    </aside>
    <section className="content">
      <header className="topbar"><div><p className="eyebrow">MEESHO CATALOG WORKSPACE</p><h1>Create a smart listing</h1></div><div className="secure"><i /> Meesho-only connection</div></header>
      <div className="stepper">{stages.map((name, index) => <button key={name} onClick={() => index <= step && setStep(index)} className={index === step ? "current" : index < step ? "done" : ""}><b>{index < step ? "✓" : index + 1}</b><span>{name}<small>{["Template & product", "Pair uploads", "Seller review", "Unique per account", "Save as ready"][index]}</small></span></button>)}</div>
      <div className="main-card">
        {notice && <div className="notice">{notice}</div>}
        {step === 0 && <Setup count={count} setCount={setCount} templates={templates} templateId={templateId} setTemplateId={setTemplateId} loading={templatesLoading} reload={loadTemplates} details={details} update={update} />}
        {step === 1 && <Images count={count} listingId={listingId} images={images} setImages={setImages} onError={setNotice} />}
        {step === 2 && <Content listingId={listingId} onError={setNotice} />}
        {step === 3 && <Skus listingId={listingId} onError={setNotice} />}
        {step === 4 && <Review listingId={listingId} count={count} template={selectedTemplate?.name || "No template selected"} onError={setNotice} />}
      </div>
      <footer className="footer"><span>{step === 0 && !setupComplete ? <span className="footer-requirement" role="status">{setupRequirement}</span> : step === 1 && !imageStepComplete ? <span className="footer-requirement" role="status">{imageRequirement}</span> : ready ? "Ready for the ListingKing extension" : listingId ? "Draft stored in Neon" : `Draft · ${count} items`}</span><div><button className="secondary" onClick={() => setStep(current => Math.max(0, current - 1))} disabled={step === 0 || makingReady}>Back</button>{step < 4 ? step === 0 && !setupComplete ? <span className="continue-locked">Continue unlocks after required fields are complete.</span> : step === 1 && !imageStepComplete ? <span className="continue-locked">Upload front images to continue.</span> : <button className="primary" onClick={() => void next()} disabled={savingDraft}>{savingDraft ? "Saving draft…" : <>Continue <span>→</span></>}</button> : <button className="primary" onClick={() => void saveReady()} disabled={makingReady || ready}>{ready ? "Listing ready" : makingReady ? "Making listing ready…" : "Save smart listing"}</button>}</div></footer>
    </section>
  </main>;
}

function Setup({ count, setCount, templates, templateId, setTemplateId, loading, reload, details, update }: { count: number; setCount: (value: number) => void; templates: SavedTemplate[]; templateId: string; setTemplateId: (value: string) => void; loading: boolean; reload: () => Promise<void>; details: Details; update: (key: keyof Details, value: string) => void }) {
  const labels: [keyof Details, string][] = [["productName", "Product name"], ["category", "Product type / category"], ["material", "Material / fabric"], ["color", "Colour"], ["style", "Fit, style or pattern"], ["audience", "Intended audience"], ["features", "Key features"], ["keywords", "Optional search keywords"], ["notes", "Notes for content review"]];
  return <><div className="section-title"><div><p className="eyebrow">STEP 01</p><h2>Start with a reusable Meesho template</h2><p>These are templates captured by the extension using this ListingKing account.</p></div><span className="pill">Meesho supplier panel</span></div>
    <div className="template-choice">
      {loading && <p className="template-empty">Loading your saved templates…</p>}
      {!loading && !templates.length && <p className="template-empty">No saved templates for this account. Capture one in the ListingKing Meesho panel, then click Refresh templates.</p>}
      {templates.map(template => <button type="button" key={template.id} className={`template ${template.id === templateId ? "selected" : ""}`} onClick={() => setTemplateId(template.id)}><b>MS</b><span><strong>{template.name}</strong><small>{template.categoryLabel} · version {template.version}</small></span>{template.id === templateId && <i>✓</i>}</button>)}
      <button type="button" className="template create" onClick={() => void reload()}><b>↻</b><span><strong>Refresh templates</strong><small>Load newly captured Meesho templates</small></span></button>
    </div>
    <h3>How many catalog items?</h3><div className="count-row">{[5, 10, 25, 50].map(value => <button key={value} className={count === value ? "count selected" : "count"} onClick={() => setCount(value)}>{value}</button>)}<label className="custom-count">Custom <input type="number" min="1" max="50" value={count} onChange={event => setCount(Math.max(1, Math.min(50, Number(event.target.value) || 1)))} /></label></div>
    <h3>SKU Code <span className="field-required" aria-label="required"> *</span></h3><p style={{margin: "-6px 0 8px", fontSize: "11px", color: "#6a767b"}}>Enter a unique integer code for this product (e.g. 4789). This will appear in every generated SKU ID.</p><div className="count-row"><label className="custom-count" style={{paddingLeft: "12px"}}><input type="number" min="1" max="99999" placeholder="e.g. 4789" value={details.skuCode} onChange={event => update("skuCode", event.target.value)} style={{width: "120px"}} /></label></div>
    <div className="form-grid">{labels.map(([key, label]) => {
      const required = key === "productName" || key === "features";
      return <label key={key} className={key === "features" || key === "notes" ? "wide" : ""}>{label}{required && <span className="field-required" aria-label="required"> *</span>}<input value={details[key]} onChange={event => update(key, event.target.value)} placeholder={label} maxLength={key === "productName" ? 80 : undefined} required={required} aria-required={required} /></label>;
    })}</div><p className="form-requirement"><span>*</span> Required to continue. All other product-detail fields are optional.</p>
  </>;
}

function Images({ count, listingId, images, setImages, onError }: { count: number; listingId: string; images: Record<ImageRole, SelectedImage[]>; setImages: Dispatch<SetStateAction<Record<ImageRole, SelectedImage[]>>>; onError: (message: string) => void }) {
  const inputs = useRef<Record<ImageRole, HTMLInputElement | null>>({ front: null, side: null, detail: null, back: null });
  const [catalogReady, setCatalogReady] = useState(false);
  const roles: { role: ImageRole; label: string; required: boolean }[] = [{ role: "front", label: "Front image", required: true }, { role: "side", label: "Side image", required: false }, { role: "detail", label: "Feature / detail", required: false }, { role: "back", label: "Last / back image", required: false }];
  useEffect(() => {
    if (!listingId) return;
    let active = true;
    const syncCatalogItems = async () => {
      setCatalogReady(false);
      try {
        const response = await fetch(`/api/smart-listings/${listingId}/count`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingCount: count }) });
        const body = await readApiJson<{ message?: string }>(response);
        if (!response.ok || !body) throw new Error(apiMessage(response, body, "Catalog items could not be prepared for image upload."));
        if (active) setCatalogReady(true);
      } catch (error) {
        if (active) onError(error instanceof Error ? error.message : "Catalog items could not be prepared for image upload.");
      }
    };
    void syncCatalogItems();
    return () => { active = false; };
  }, [listingId, count, onError]);
  const addFiles = async (role: ImageRole, event: ChangeEvent<HTMLInputElement>) => {
    if (!catalogReady) {
      onError("Catalog items are still being prepared. Please wait a moment and try again.");
      event.target.value = "";
      return;
    }
    const files = [...(event.target.files || [])];
    const allowed = files.filter(file => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 10 * 1024 * 1024).slice(0, Math.max(0, count - images[role].length));
    if (files.length !== allowed.length) onError("Only JPG, PNG, or WEBP files up to 10 MB can be uploaded. Extra files beyond the listing count were skipped.");
    for (const file of allowed) {
      const image: SelectedImage = { id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`, file, url: URL.createObjectURL(file), uploading: true };
      setImages(current => ({ ...current, [role]: [...current[role], image] }));
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("role", role);
        form.append("position", String(images[role].length + allowed.indexOf(file) + 1));
        const response = await fetch(`/api/smart-listings/${listingId}/images`, { method: "POST", body: form });
        const body = await readApiJson<{ id: string; message?: string }>(response);
        if (!response.ok || !body?.id) throw new Error(apiMessage(response, body, "Image could not be stored."));
        setImages(current => ({ ...current, [role]: current[role].map(entry => entry.id === image.id ? { ...entry, uploading: false, stored: true, databaseId: body.id } : entry) }));
      } catch (error) {
        setImages(current => ({ ...current, [role]: current[role].filter(entry => entry.id !== image.id) }));
        URL.revokeObjectURL(image.url);
        onError(error instanceof Error ? error.message : "Image could not be stored.");
      }
    }
    event.target.value = "";
  };
  const remove = async (role: ImageRole, id: string) => {
    const removed = images[role].find(image => image.id === id);
    if (!removed || removed.uploading) return;
    try {
      if (removed.databaseId) {
        const response = await fetch(`/api/smart-listings/${listingId}/images?imageId=${encodeURIComponent(removed.databaseId)}`, { method: "DELETE" });
        const body = await readApiJson<{ message?: string }>(response);
        if (!response.ok || !body) throw new Error(apiMessage(response, body, "Image could not be deleted."));
      }
      URL.revokeObjectURL(removed.url);
      setImages(current => ({ ...current, [role]: current[role].filter(image => image.id !== id) }));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Image could not be deleted.");
    }
  };
  const total = Object.values(images).reduce((sum, group) => sum + group.length, 0);
  return <><div className="section-title"><div><p className="eyebrow">STEP 02</p><h2>Pair images with each catalog item</h2><p>Images upload immediately to secure Supabase Storage and their pairing is saved in Neon. Upload order determines pairing: first image → item 1.</p></div></div><div className="image-summary"><strong>{count}<small>front images required</small></strong><strong>{total}<small>images selected</small></strong><strong>{Math.max(0, count - images.front.length)}<small>fronts missing</small></strong><strong>{count}<small>catalog items</small></strong></div><div className="image-grid">{roles.map(({ role, label, required }) => <section className={`dropzone image-slot ${images[role].length >= count ? "complete" : ""}`} key={role}><div><span className={required ? "required-dot" : "optional-dot"} /><strong>{label}</strong><em>{required ? "Required" : "Optional"}</em></div><p>{images[role].length} of {count} uploaded</p><div className="image-progress"><i style={{ width: `${Math.min(100, images[role].length / count * 100)}%` }} /></div><input ref={node => { inputs.current[role] = node; }} id={`upload-${role}`} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={event => void addFiles(role, event)} /><button type="button" className="upload" disabled={!catalogReady} onClick={() => inputs.current[role]?.click()}>{catalogReady ? "+ Add images" : "Preparing catalog items…"}</button><div className="image-thumbs">{images[role].map((image, index) => <figure key={image.id}><img src={image.url} alt={`${label} ${index + 1}`} /><button type="button" disabled={image.uploading} onClick={() => void remove(role, image.id)} aria-label={`Remove ${image.file.name}`}>×</button><figcaption>{image.uploading ? "Uploading…" : image.stored ? "Stored" : index + 1}</figcaption></figure>)}</div></section>)}</div><section className="pairing-preview"><div><h3>Listing pairing preview</h3><p>Each Stored image has been uploaded to Supabase and linked to this Smart Listing in Neon.</p></div><div className="pairing-table"><div className="pairing-head"><span>#</span><span>Front</span><span>Side</span><span>Detail</span><span>Back</span><span>Status</span></div>{Array.from({ length: count }, (_, index) => <div className="pairing-row" key={index}><b>{String(index + 1).padStart(3, "0")}</b>{(["front", "side", "detail", "back"] as ImageRole[]).map(role => images[role][index] ? <span className="paired-file" key={role}>{images[role][index].file.name}</span> : <span className="missing-file" key={role}>—</span>)}<em className={images.front[index]?.stored ? "row-ready" : "row-missing"}>{images.front[index]?.stored ? "Stored" : "Needs front"}</em></div>)}</div></section></>; }
type ListingContentItem = { id: string; position: number; title: string | null; description: string | null; mrp: string | number | null; meeshoPrice: string | number | null; defectivePrice: string | number | null; inventory: string | number; sku: string | null; images?: { id: string; role: string }[]; validationJson?: { inventory?: number } | null };

function Content({ listingId, onError }: { listingId: string; onError: (message: string) => void }) {
  const [items, setItems] = useState<ListingContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const numberValue = (value: string | number | null) => value === null ? "" : String(value);

  const load = async () => {
    if (!listingId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/smart-listings/${listingId}`, { cache: "no-store" });
      const body = await readApiJson<{ items: Omit<ListingContentItem, "inventory">[]; message?: string }>(response);
      if (!response.ok || !body) throw new Error(apiMessage(response, body, "Content draft could not be loaded."));
      setItems(body.items.map((item: Omit<ListingContentItem, "inventory">) => ({ ...item, inventory: item.validationJson?.inventory ?? 1 })));
    } catch (error) { onError(error instanceof Error ? error.message : "Content draft could not be loaded."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [listingId]);
  const positiveNumber = (value: string | number | null | undefined) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  };
  const update = (id: string, field: keyof ListingContentItem, value: string) => setItems(current => current.map(item => {
    if (item.id !== id) return item;
    if (field === "mrp") {
      const mrp = positiveNumber(value);
      const meeshoPrice = positiveNumber(item.meeshoPrice);
      return { ...item, mrp: value, meeshoPrice: mrp !== null && meeshoPrice !== null && meeshoPrice > mrp ? String(mrp) : item.meeshoPrice };
    }
    if (field === "meeshoPrice") {
      const mrp = positiveNumber(item.mrp);
      const meeshoPrice = positiveNumber(value);
      return { ...item, meeshoPrice: mrp !== null && meeshoPrice !== null && meeshoPrice > mrp ? String(mrp) : value };
    }
    return { ...item, [field]: value };
  }));
  const applyBase = (field: "mrp" | "meeshoPrice" | "defectivePrice" | "inventory", value: string) => setItems(current => current.map(item => {
    if (field === "mrp") {
      const mrp = positiveNumber(value);
      const meeshoPrice = positiveNumber(item.meeshoPrice);
      return { ...item, mrp: value, meeshoPrice: mrp !== null && meeshoPrice !== null && meeshoPrice > mrp ? String(mrp) : item.meeshoPrice };
    }
    if (field === "meeshoPrice") {
      const mrp = positiveNumber(item.mrp);
      const meeshoPrice = positiveNumber(value);
      return { ...item, meeshoPrice: mrp !== null && meeshoPrice !== null && meeshoPrice > mrp ? String(mrp) : value };
    }
    return { ...item, [field]: value };
  }));
  const generate = async () => {
    setGenerating(true);
    try {
      const response = await fetch(`/api/smart-listings/${listingId}/generate`, { method: "POST" });
      const body = await readApiJson<{ items: Omit<ListingContentItem, "inventory">[]; warnings?: string[]; message?: string }>(response);
      if (!response.ok || !body) throw new Error(apiMessage(response, body, "AI could not generate drafts."));
      setItems(body.items.map((item: Omit<ListingContentItem, "inventory">) => ({ ...item, inventory: item.validationJson?.inventory ?? 1 })));
      if (body.warnings?.length) onError(body.warnings.join(" "));
    } catch (error) { onError(error instanceof Error ? error.message : "AI could not generate drafts."); }
    finally { setGenerating(false); }
  };
  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/smart-listings/${listingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: items.map(item => ({ id: item.id, title: item.title || "", description: item.description || "", mrp: item.mrp || "", meeshoPrice: item.meeshoPrice || "", defectivePrice: item.defectivePrice || undefined, inventory: item.inventory || "" })) }) });
      const body = await readApiJson<{ message?: string }>(response);
      if (!response.ok || !body) throw new Error(apiMessage(response, body, "Content and prices could not be saved."));
    } catch (error) { onError(error instanceof Error ? error.message : "Content and prices could not be saved."); }
    finally { setSaving(false); }
  };
  if (loading) return <p className="template-empty">Loading your catalog items…</p>;
  return <><div className="section-title"><div><p className="eyebrow">STEP 03</p><h2>Product titles, descriptions & pricing</h2><p>AI creates drafts only. Every title, description, MRP, Meesho price, and inventory value is required. Wrong / defective return price is optional.</p></div><button type="button" className="secondary" onClick={() => void generate()} disabled={generating}>{generating ? "Generating…" : "Generate titles & descriptions"}</button></div><section className="pricing-workspace"><div className="pricing-heading"><strong>Base price</strong><span>Apply seller-entered prices and inventory to every item. You can still edit any item below.</span></div><div className="pricing-columns"><span>#</span><span>Title *</span><span>MRP *</span><span>Meesho price *</span><span>Wrong / defective</span><span>Inventory *</span></div><div className="base-price-row"><span>All items</span><span className="base-price-note">Titles are set per item</span><input aria-label="Apply MRP to all" type="number" min="1" placeholder="MRP" onChange={event => applyBase("mrp", event.target.value)} /><input aria-label="Apply Meesho price to all" type="number" min="1" placeholder="Selling price" onChange={event => applyBase("meeshoPrice", event.target.value)} /><input aria-label="Apply return price to all (optional)" type="number" min="1" placeholder="Optional" onChange={event => applyBase("defectivePrice", event.target.value)} /><input aria-label="Apply inventory to all" type="number" min="1" placeholder="Inventory" onChange={event => applyBase("inventory", event.target.value)} /></div>{items.map(item => <div className="content-price-row" key={item.id}><b>{item.position}</b><input required aria-required="true" value={item.title || ""} maxLength={100} placeholder={`Title for item ${item.position}`} onChange={event => update(item.id, "title", event.target.value)} /><input required aria-required="true" type="number" min="1" value={numberValue(item.mrp)} onChange={event => update(item.id, "mrp", event.target.value)} /><input required aria-required="true" type="number" min="1" value={numberValue(item.meeshoPrice)} onChange={event => update(item.id, "meeshoPrice", event.target.value)} /><input aria-label={`Optional wrong or defective return price for item ${item.position}`} type="number" min="1" value={numberValue(item.defectivePrice)} onChange={event => update(item.id, "defectivePrice", event.target.value)} /><input required aria-required="true" type="number" min="1" value={numberValue(item.inventory)} onChange={event => update(item.id, "inventory", event.target.value)} /></div>)}</section><section className="description-workspace"><div className="description-heading"><div><h3>Product descriptions *</h3><p>Expand every item to review or edit the required seller-reviewed description.</p></div><button type="button" className="secondary" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save content & prices"}</button></div>{items.map(item => <article className="description-row" key={item.id}><button type="button" className="description-toggle" onClick={() => setExpanded(current => current === item.id ? null : item.id)}><b>{item.position}</b><span className="description-preview"><strong>{item.title || `Item ${item.position} needs a title`}</strong><small>{item.description ? item.description.replace(/\s+/g, " ").slice(0, 180) : "Description needed."}</small></span><i>{expanded === item.id ? "⌃" : "⌄"}</i></button>{expanded === item.id && <textarea required aria-required="true" value={item.description || ""} maxLength={1500} placeholder="Enter a marketplace-safe description" onChange={event => update(item.id, "description", event.target.value)} />}</article>)}</section></>; }
function Skus({ listingId, onError }: { listingId: string; onError: (message: string) => void }) {
  const [items, setItems] = useState<{ id: string; position: number; sku: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!listingId) return;
    const load = async () => {
      setLoading(true);
      try {
        const syncResponse = await fetch(`/api/smart-listings/${listingId}/skus`, { method: "POST" });
        const syncBody = await readApiJson<{ message?: string }>(syncResponse);
        if (!syncResponse.ok || !syncBody) throw new Error(apiMessage(syncResponse, syncBody, "SKU IDs could not be generated."));
        const response = await fetch(`/api/smart-listings/${listingId}`, { cache: "no-store" });
        const body = await readApiJson<{ items?: { id: string; position: number; sku: string | null }[]; message?: string }>(response);
        if (!response.ok || !body) throw new Error(apiMessage(response, body, "SKU IDs could not be loaded."));
        setItems(body.items || []);
      } catch (error) {
        onError(error instanceof Error ? error.message : "SKU IDs could not be loaded.");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [listingId, onError]);

  const startEdit = (item: { id: string; sku: string | null }) => {
    setEditingId(item.id);
    setEditValue(item.sku || "");
  };
  const cancelEdit = () => { setEditingId(null); setEditValue(""); };
  const saveEdit = async (itemId: string) => {
    if (!editValue.trim()) { onError("SKU cannot be empty."); return; }
    setSaving(true);
    try {
      const response = await fetch(`/api/smart-listings/${listingId}/skus`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, sku: editValue.trim() }),
      });
      const body = await readApiJson<{ message?: string }>(response);
      if (!response.ok || !body) throw new Error(apiMessage(response, body, "SKU could not be updated."));
      setItems(current => current.map(item => item.id === itemId ? { ...item, sku: editValue.trim() } : item));
      setEditingId(null);
      setEditValue("");
    } catch (error) {
      onError(error instanceof Error ? error.message : "SKU could not be updated.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="template-empty">Loading the saved SKU IDs…</p>;
  return <><div className="section-title"><div><p className="eyebrow">STEP 04</p><h2>Every item receives a unique SKU</h2><p>These exact stored IDs are used again on Review and by the ListingKing extension.</p></div></div><div className="sku-list">{items.map(item => <label key={item.id}><span>{String(item.position).padStart(2, "0")}</span>{editingId === item.id ? <input value={editValue} onChange={event => setEditValue(event.target.value)} autoFocus /> : <input value={item.sku || "SKU pending"} readOnly />}{editingId === item.id ? <span style={{display: "flex", gap: "6px"}}><button className="primary" style={{padding: "4px 10px", fontSize: "11px"}} onClick={() => void saveEdit(item.id)} disabled={saving}>{saving ? "…" : "Save"}</button><button className="secondary" style={{padding: "4px 8px", fontSize: "11px"}} onClick={cancelEdit} disabled={saving}>✕</button></span> : <span style={{display: "flex", gap: "8px", alignItems: "center"}}><button className="secondary" style={{padding: "4px 10px", fontSize: "11px"}} onClick={() => startEdit(item)}>Edit</button><em>Available</em></span>}</label>)}</div></>;
}
function Review({ listingId, count, template, onError }: { listingId: string; count: number; template: string; onError: (message: string) => void }) {
  const [items, setItems] = useState<ListingContentItem[]>([]);
  const [reviewTemplate, setReviewTemplate] = useState(template);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!listingId) return;
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/smart-listings/${listingId}`, { cache: "no-store" });
        const body = await readApiJson<{ items?: ListingContentItem[]; template?: { name?: string }; message?: string }>(response);
        if (!response.ok || !body) throw new Error(apiMessage(response, body, "The saved listing could not be loaded for review."));
        setItems(body.items || []);
        setReviewTemplate(body.template?.name || template);
      } catch (error) {
        onError(error instanceof Error ? error.message : "The saved listing could not be loaded for review.");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [listingId, onError, template]);

  if (loading) return <p className="template-empty">Loading your saved listing for review…</p>;
  return <><div className="section-title"><div><p className="eyebrow">STEP 05</p><h2>One final review before saving</h2><p>Check each generated title, description, price, SKU, and image count before making this listing Ready.</p></div></div><div className="review-grid"><div><small>TEMPLATE</small><strong>{reviewTemplate}</strong><span>Meesho only</span></div><div><small>ITEMS</small><strong>{items.length || count}</strong><span>Seller-reviewed data</span></div><div><small>FRONT IMAGES</small><strong>{items.filter(item => item.images?.some(image => image.role === "FRONT")).length}/{items.length || count}</strong><span>Stored in Supabase</span></div></div><div className={`review-items ${reviewStyles.items}`}>{items.map(item => <article key={item.id}><b>{String(item.position).padStart(2, "0")}</b><div className={reviewStyles.content}><strong>{item.title || `Item ${item.position}`}</strong><p>{item.description || "No description saved."}</p><dl><div><dt>MRP</dt><dd>₹{item.mrp ?? "—"}</dd></div><div><dt>Meesho price</dt><dd>₹{item.meeshoPrice ?? "—"}</dd></div><div><dt>Defective return</dt><dd>₹{item.defectivePrice ?? "—"}</dd></div></dl></div><code>{item.sku || "SKU pending"}</code></article>)}</div></>;
}
