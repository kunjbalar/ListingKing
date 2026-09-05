"use client";

import { ChangeEvent, Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import reviewStyles from "./review.module.css";

type Details = { productName: string; category: string; material: string; color: string; style: string; features: string; audience: string; keywords: string; notes: string; skuCode: string };
type SavedTemplate = { id: string; name: string; categoryLabel: string; version: number };
type ImageRole = "front" | "side" | "detail" | "back";
type SelectedImage = { id: string; file: File; url: string; uploading?: boolean; stored?: boolean; databaseId?: string };

const initial: Details = { productName: "", category: "", material: "", color: "", style: "", features: "", audience: "", keywords: "", notes: "", skuCode: "" };
const stages = ["Setup", "Images", "Content & prices", "SKU IDs", "Review"];
const stageSubtitles = ["Template & product", "Pair uploads", "Details and pricing", "Unique per account", "Save as ready"];

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

  const footerLabel = step === 3 ? "Save SKUs ID" : step === 2 ? "Save content & prices and continue →" : step === 1 ? "Upload front images to continue. →" : "Continue to Images →";

  return <main className="shell">
    {/* Left Sidebar */}
    <aside className="sidebar">
      <a className="sidebar-brand" href="#">
        <svg className="brand-crown-icon" viewBox="0 0 24 20" fill="none">
          <path d="M2 17.5h20M2.5 17.5L5 6l4.5 5.5L12 3l2.5 8.5L19 6l2.5 11.5z" stroke="#e5b842" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="brand-text">ListingKing</span>
      </a>

      <div className="sidebar-section-title">WORKSPACE</div>
      <div className="sidebar-nav">
        <button type="button" className="sidebar-nav-item" onClick={() => setStep(0)}>
          <span className="sidebar-nav-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </span>
          Overview
        </button>
        <button type="button" className="sidebar-nav-item" onClick={() => setStep(0)}>
          <span className="sidebar-nav-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="7" y1="8" x2="17" y2="8"/>
              <line x1="7" y1="12" x2="17" y2="12"/>
              <line x1="7" y1="16" x2="13" y2="16"/>
            </svg>
          </span>
          Templates
        </button>
        <button type="button" className="sidebar-nav-item active" onClick={() => setStep(0)}>
          <span className="sidebar-nav-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2z"/>
            </svg>
          </span>
          Smart listings
        </button>
        <button type="button" className="sidebar-nav-item" onClick={() => setStep(0)}>
          <span className="sidebar-nav-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="4" width="18" height="16" rx="2"/>
              <line x1="3" y1="9" x2="21" y2="9"/>
              <line x1="7" y1="6.5" x2="7.01" y2="6.5"/>
            </svg>
          </span>
          Extension guide
        </button>
        <button type="button" className="sidebar-nav-item" onClick={() => setStep(0)}>
          <span className="sidebar-nav-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </span>
          Settings
        </button>
      </div>

      {/* Create listing Timeline Card */}
      <div className="create-listing-card">
        <div className="create-listing-header">
          <h3>Create listing</h3>
          <span className="chevron">▲</span>
        </div>
        <div className="sidebar-timeline">
          <div className="timeline-line" />
          {stages.map((name, index) => {
            const isCurrent = index === step;
            const isDone = index < step;
            const statusClass = isCurrent ? "active" : isDone ? "done" : "inactive";
            return (
              <button
                key={name}
                type="button"
                onClick={() => index <= step && setStep(index)}
                className={`timeline-step ${statusClass}`}
              >
                <div className="timeline-circle">
                  {String(index + 1).padStart(2, "0")}
                </div>
                <div className="timeline-text">
                  <span className="timeline-title">{name}</span>
                  <span className="timeline-subtitle">{stageSubtitles[index]}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom User Pill */}
      <div className="sidebar-user-pill">
        <div className="user-card" onClick={() => { if (confirm("Sign out of ListingKing?")) signOut({ callbackUrl: "/sign-in" }); }}>
          <div className="user-avatar">KB</div>
          <div className="user-info">
            <span className="user-name">Kunj Balar</span>
            <span className="user-email">kunj@example.com</span>
          </div>
          <span className="user-chevron">▾</span>
        </div>
      </div>
    </aside>

    {/* Main Content Area */}
    <section className="content">
      {/* Top Header */}
      <header className="topbar">
        <div className="topbar-breadcrumbs">
          <span>Create listing</span>
          <span className="breadcrumb-sep">/</span>
          <span>{stages[step]}</span>
        </div>
        <div className="meesho-status-pill">
          <span className="status-dot-green" />
          <span>Meesho connection</span>
          <span className="chevron">▾</span>
        </div>
      </header>

      {/* Scrollable Body Area */}
      <div className="content-body">
        {notice && <div className="notice-banner">{notice}</div>}
        {step === 0 && (
          <Setup
            count={count}
            setCount={setCount}
            templates={templates}
            templateId={templateId}
            setTemplateId={setTemplateId}
            loading={templatesLoading}
            reload={loadTemplates}
            details={details}
            update={update}
          />
        )}
        {step === 1 && <Images count={count} listingId={listingId} images={images} setImages={setImages} onError={setNotice} />}
        {step === 2 && <Content listingId={listingId} onError={setNotice} />}
        {step === 3 && <Skus listingId={listingId} onError={setNotice} />}
        {step === 4 && <Review listingId={listingId} count={count} template={selectedTemplate?.name || "No template selected"} onError={setNotice} />}
      </div>

      {/* Full-width Fixed Footer / Action Bar spanning from sidebar to right edge */}
      <footer className="main-footer-bar">
        <div className="footer-left">
          {step === 0 ? (
            notice ? <span className="footer-requirement" role="status">{notice}</span> : null
          ) : step === 1 && !imageStepComplete ? (
            <div className="footer-notice-pill warning">
              <span className="footer-pill-icon">💡</span>
              <span>{imageRequirement}</span>
            </div>
          ) : (
            <div className="footer-notice-pill ready">
              <span className="footer-pill-icon">🌿</span>
              <div>
                <strong>Draft stored in Neon</strong>
                <small>Your progress is safely saved as you go.</small>
              </div>
            </div>
          )}
        </div>

        <div className="footer-right">
          {step === 0 ? (
            <>
              <button
                type="button"
                className="btn-discard"
                onClick={() => {
                  if (confirm("Discard changes to product details?")) {
                    setDetails(initial);
                  }
                }}
              >
                Discard
              </button>
              <button
                type="button"
                className="btn-continue-primary"
                onClick={() => void next()}
                disabled={savingDraft}
              >
                {savingDraft ? "Saving draft…" : <>Continue to Images <span className="btn-arrow">→</span></>}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn-back-secondary"
                onClick={() => setStep(current => Math.max(0, current - 1))}
                disabled={makingReady}
              >
                Back
              </button>
              {step < 4 ? (
                <button
                  type="button"
                  className="btn-continue-primary"
                  onClick={() => void next()}
                  disabled={savingDraft || (step === 1 && !imageStepComplete)}
                >
                  {savingDraft ? "Saving draft…" : step === 3 ? (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: 4}}>
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                        <polyline points="17 21 17 13 7 13 7 21"/>
                        <polyline points="7 3 7 8 15 8"/>
                      </svg>
                      Save SKUs ID
                    </>
                  ) : (
                    footerLabel
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-continue-primary"
                  onClick={() => void saveReady()}
                  disabled={makingReady || ready}
                >
                  {ready ? "✓ Listing ready" : makingReady ? "Making listing ready…" : "Save smart listing →"}
                </button>
              )}
            </>
          )}
        </div>
      </footer>
    </section>
  </main>;
}

function Setup({
  count,
  setCount,
  templates,
  templateId,
  setTemplateId,
  loading,
  reload,
  details,
  update,
}: {
  count: number;
  setCount: (value: number) => void;
  templates: SavedTemplate[];
  templateId: string;
  setTemplateId: (value: string) => void;
  loading: boolean;
  reload: () => Promise<void>;
  details: Details;
  update: (key: keyof Details, value: string) => void;
}) {
  const [customMode, setCustomMode] = useState(false);

  return (
    <div className="setup-layout">
      {/* COLUMN 1: Templates, Quantity & About */}
      <div className="setup-col-left">
        <p className="eyebrow-orange">SETUP YOUR LISTING</p>
        <h1 className="setup-title">Start with a template built for Meesho</h1>
        <div className="setup-title-divider" />

        <h3 className="section-subheading">Choose a reusable template</h3>
        <div className="template-cards-grid">
          {loading && <p className="template-empty">Loading your saved templates…</p>}
          {!loading && !templates.length && (
            <p className="template-empty">No saved templates for this account. Capture one in the ListingKing Meesho panel, then click Refresh templates.</p>
          )}
          {templates.map(template => {
            const isSelected = template.id === templateId;
            return (
              <button
                type="button"
                key={template.id}
                className={`template-card ${isSelected ? "selected" : ""}`}
                onClick={() => setTemplateId(template.id)}
              >
                <div className="tpl-icon">
                  <svg width="24" height="28" viewBox="0 0 24 28" fill="none" stroke={isSelected ? "#ef4423" : "#9ca3af"} strokeWidth="1.6">
                    <path d="M4 2h11l5 5v19H4V2z"/>
                    <path d="M15 2v5h5M8 12h8M8 16h8M8 20h5"/>
                  </svg>
                </div>
                <div className="tpl-body">
                  <strong className="tpl-name">{template.name}</strong>
                  <span className="tpl-cat">{template.categoryLabel}</span>
                  <span className="tpl-ver">v{template.version}</span>
                </div>
                <span className={`tpl-badge ${isSelected ? "checked" : "empty"}`}>
                  {isSelected ? "✓" : ""}
                </span>
              </button>
            );
          })}
        </div>

        {/* Refresh templates button */}
        <button type="button" className="refresh-templates-btn" onClick={() => void reload()}>
          <div className="refresh-btn-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0f171c" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
            <div className="refresh-btn-text">
              <strong>Refresh templates</strong>
              <small>Load newly captured Meesho templates</small>
            </div>
          </div>
          <span className="refresh-chevron">›</span>
        </button>

        {/* Quantity selector */}
        <h3 className="section-subheading">How many catalog items?</h3>
        <div className="count-pills">
          {[5, 10, 25, 50].map(value => (
            <button
              key={value}
              type="button"
              className={`count-pill ${count === value && !customMode ? "selected" : ""}`}
              onClick={() => { setCustomMode(false); setCount(value); }}
            >
              {value}
            </button>
          ))}
          <button
            type="button"
            className={`count-pill custom-pill ${customMode || ![5, 10, 25, 50].includes(count) ? "selected" : ""}`}
            onClick={() => setCustomMode(true)}
          >
            {customMode ? (
              <input
                type="number"
                min="1"
                max="50"
                value={count}
                autoFocus
                onChange={e => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                onBlur={() => { if ([5, 10, 25, 50].includes(count)) setCustomMode(false); }}
                className="custom-count-inline-input"
              />
            ) : (
              <>
                <span>{![5, 10, 25, 50].includes(count) ? count : "Custom"}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                </svg>
              </>
            )}
          </button>
        </div>

        {/* About templates card */}
        <div className="about-templates-card">
          <div className="about-content">
            <h4>About templates</h4>
            <div className="about-gold-line" />
            <p>Templates capture structure from Meesho using your account. Use them to create accurate, compliant catalog listings faster.</p>
          </div>
          <div className="about-illustration">
            <svg width="100" height="90" viewBox="0 0 120 110" fill="none">
              <path d="M95 105C80 85 70 55 75 15" stroke="#7a927a" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M75 15C70 25 78 38 82 35C86 32 80 20 75 15Z" fill="#a8bfa8" fillOpacity="0.8" />
              <path d="M75 15C77 24 81 29 82 35" stroke="#688068" strokeWidth="0.8" />
              <path d="M72 45C58 40 50 50 55 58C60 66 70 55 72 45Z" fill="#b4c7b4" fillOpacity="0.75" />
              <path d="M75 42C90 35 100 45 96 55C92 65 80 52 75 42Z" fill="#9db59d" fillOpacity="0.8" />
              <path d="M71 68C52 64 45 76 52 85C59 94 68 78 71 68Z" fill="#a2bba2" fillOpacity="0.8" />
              <path d="M77 65C95 58 106 70 101 82C96 94 82 76 77 65Z" fill="#8ea88e" fillOpacity="0.75" />
              <path d="M83 88C68 86 62 96 68 103C74 110 82 96 83 88Z" fill="#b0c4b0" fillOpacity="0.7" />
            </svg>
          </div>
        </div>
      </div>

      {/* COLUMN 2: Product Details Form */}
      <div className="setup-col-middle">
        <div className="product-details-card">
          <div className="product-details-header">
            <h2>Product details</h2>
            <span className="required-badge"><span className="red-asterisk">*</span> Required</span>
          </div>
          <div className="product-header-line" />

          {/* SKU Code */}
          <div className="form-field sku-field">
            <label className="field-label">SKU Code <span className="red-asterisk">*</span></label>
            <span className="field-hint">Unique integer code (e.g. 4789)</span>
            <div className="sku-input-wrapper">
              <input
                type="number"
                min="1"
                max="99999"
                placeholder="e.g. 4789"
                value={details.skuCode}
                onChange={event => update("skuCode", event.target.value)}
                required
                aria-required="true"
                className="form-input"
              />
              <div className="barcode-icon-wrap" aria-hidden="true">
                <svg width="22" height="15" viewBox="0 0 22 15" fill="currentColor">
                  <rect x="0" y="0" width="1.5" height="15" />
                  <rect x="3" y="0" width="0.8" height="15" />
                  <rect x="5.5" y="0" width="2" height="15" />
                  <rect x="9" y="0" width="0.8" height="15" />
                  <rect x="11.5" y="0" width="1.8" height="15" />
                  <rect x="14.5" y="0" width="0.8" height="15" />
                  <rect x="16.5" y="0" width="1.8" height="15" />
                  <rect x="19.5" y="0" width="0.8" height="15" />
                  <rect x="21" y="0" width="1" height="15" />
                </svg>
              </div>
            </div>
          </div>

          {/* Product name & Category */}
          <div className="form-row-2col">
            <div className="form-field">
              <label className="field-label">Product name <span className="red-asterisk">*</span></label>
              <input
                type="text"
                value={details.productName}
                onChange={event => update("productName", event.target.value)}
                placeholder="Enter product name"
                maxLength={80}
                required
                aria-required="true"
                className="form-input"
              />
            </div>
            <div className="form-field">
              <label className="field-label">Product type / category <span className="red-asterisk">*</span></label>
              <div className="select-input-wrapper">
                <input
                  type="text"
                  value={details.category}
                  onChange={event => update("category", event.target.value)}
                  placeholder="Select category"
                  className="form-input"
                />
                <span className="dropdown-chevron">▾</span>
              </div>
            </div>
          </div>

          <div className="form-divider-dashed" />

          {/* Specifications */}
          <div className="form-section-title">
            <h3>Specifications</h3>
            <p>Core attributes of your product</p>
          </div>

          <div className="form-row-2col">
            <div className="form-field">
              <label className="field-label">Material / fabric</label>
              <div className="select-input-wrapper">
                <input
                  type="text"
                  value={details.material}
                  onChange={event => update("material", event.target.value)}
                  placeholder="Select material"
                  className="form-input"
                />
                <span className="dropdown-chevron">▾</span>
              </div>
            </div>
            <div className="form-field">
              <label className="field-label">Colour</label>
              <div className="select-input-wrapper">
                <input
                  type="text"
                  value={details.color}
                  onChange={event => update("color", event.target.value)}
                  placeholder="Select colour"
                  className="form-input"
                />
                <span className="dropdown-chevron">▾</span>
              </div>
            </div>
          </div>

          <div className="form-row-2col" style={{ marginTop: "12px" }}>
            <div className="form-field">
              <label className="field-label">Fit, style or pattern</label>
              <div className="select-input-wrapper">
                <input
                  type="text"
                  value={details.style}
                  onChange={event => update("style", event.target.value)}
                  placeholder="Select fit, style or pattern"
                  className="form-input"
                />
                <span className="dropdown-chevron">▾</span>
              </div>
            </div>
            <div className="form-field">
              <label className="field-label">Intended audience</label>
              <div className="select-input-wrapper">
                <input
                  type="text"
                  value={details.audience}
                  onChange={event => update("audience", event.target.value)}
                  placeholder="Select audience"
                  className="form-input"
                />
                <span className="dropdown-chevron">▾</span>
              </div>
            </div>
          </div>

          <div className="form-divider-dashed" />

          {/* Highlights & Search */}
          <div className="form-section-title">
            <h3>Highlights &amp; search</h3>
            <p>Help Meesho understand your product better</p>
          </div>

          <div className="form-field">
            <label className="field-label">Key features <span className="red-asterisk">*</span></label>
            <div className="textarea-wrapper">
              <textarea
                value={details.features}
                onChange={event => update("features", event.target.value)}
                placeholder="Enter key features"
                maxLength={500}
                required
                aria-required="true"
                className="form-textarea"
                rows={3}
              />
              <span className="textarea-count">{details.features.length} / 500</span>
            </div>
          </div>

          <div className="form-field">
            <label className="field-label">Optional search keywords</label>
            <span className="field-hint">Add keywords separated by commas</span>
            <input
              type="text"
              value={details.keywords}
              onChange={event => update("keywords", event.target.value)}
              placeholder=""
              className="form-input"
            />
          </div>

          <div className="form-field">
            <label className="field-label">Notes for content review</label>
            <span className="field-hint">Anything our team should know?</span>
            <div className="textarea-wrapper">
              <textarea
                value={details.notes}
                onChange={event => update("notes", event.target.value)}
                placeholder="Add notes (optional)"
                maxLength={300}
                className="form-textarea"
                rows={2}
              />
              <span className="textarea-count">{details.notes.length} / 300</span>
            </div>
          </div>
        </div>
      </div>

      {/* COLUMN 3: Right Tips & Info Cards */}
      <div className="setup-col-right">
        {/* Why use templates card */}
        <div className="why-templates-card">
          <div className="why-header-illustration">
            <div className="why-check-circle">✓</div>
            <svg width="100" height="90" viewBox="0 0 100 90" fill="none">
              <rect x="18" y="24" width="64" height="52" rx="6" fill="#e8ebe6" />
              <rect x="22" y="16" width="56" height="16" rx="4" fill="#dce0da" />
              <rect x="36" y="22" width="28" height="6" rx="2" fill="#2d5236" />
              <rect x="30" y="34" width="40" height="4" rx="1.5" fill="#c7ccc4" />
              <rect x="24" y="52" width="52" height="14" rx="3" fill="#d0d6ce" />
              <rect x="28" y="58" width="44" height="3" rx="1.5" fill="#244a32" />
              <circle cx="14" cy="28" r="2.5" fill="#244a32" />
              <circle cx="50" cy="18" r="2" fill="#ffffff" fillOpacity="0.8" />
              <circle cx="60" cy="46" r="3" fill="#ffffff" fillOpacity="0.8" />
            </svg>
          </div>
          <h3>Why use templates?</h3>
          <ul className="why-bullets">
            <li>
              <span className="bullet-dot">●</span>
              <span>Accurate structure from Meesho</span>
            </li>
            <li>
              <span className="bullet-dot">●</span>
              <span>Saves time on repetitive listings</span>
            </li>
            <li>
              <span className="bullet-dot">●</span>
              <span>Reduces errors and rejections</span>
            </li>
          </ul>
        </div>

        {/* TIP card */}
        <div className="tip-card">
          <div className="tip-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#244a32">
              <path d="M12 2C8 2 4 6 4 11c0 3.5 2 6.5 5 8v3h6v-3c3-1.5 5-4.5 5-8 0-5-4-9-8-9zm-1 18h2v-1h-2v1zm0-3h2c2.5-1 4-3.5 4-6 0-3.5-2.5-6-6-6s-6 2.5-6 6c0 2.5 1.5 5 4 6v0z"/>
            </svg>
            <strong>TIP</strong>
          </div>
          <p>You can review and edit all details in later steps before submitting to Meesho.</p>
        </div>
      </div>
    </div>
  );
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
  return <><div className="section-title"><div><p className="eyebrow-orange">STEP 02</p><h2>Pair images with each catalog item</h2><p>Images upload immediately to secure Supabase Storage and their pairing is saved in Neon. Upload order determines pairing: first image → item 1.</p></div></div><div className="image-summary"><strong>{count}<small>front images required</small></strong><strong>{total}<small>images selected</small></strong><strong>{Math.max(0, count - images.front.length)}<small>fronts missing</small></strong><strong>{count}<small>catalog items</small></strong></div><div className="image-grid">{roles.map(({ role, label, required }) => <section className={`dropzone image-slot ${images[role].length >= count ? "complete" : ""}`} key={role}><div><span className={required ? "required-dot" : "optional-dot"} /><strong>{label}</strong><em>{required ? "Required" : "Optional"}</em></div><p>{images[role].length} of {count} uploaded</p><div className="image-progress"><i style={{ width: `${Math.min(100, images[role].length / count * 100)}%` }} /></div><input ref={node => { inputs.current[role] = node; }} id={`upload-${role}`} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={event => void addFiles(role, event)} /><button type="button" className="upload" disabled={!catalogReady} onClick={() => inputs.current[role]?.click()}>{catalogReady ? "+ Add images" : "Preparing catalog items…"}</button><div className="image-thumbs">{images[role].map((image, index) => <figure key={image.id}><img src={image.url} alt={`${label} ${index + 1}`} /><button type="button" disabled={image.uploading} onClick={() => void remove(role, image.id)} aria-label={`Remove ${image.file.name}`}>×</button><figcaption>{image.uploading ? "Uploading…" : image.stored ? "Stored" : index + 1}</figcaption></figure>)}</div></section>)}</div><section className="pairing-preview"><div><h3>Listing pairing preview</h3><p>Each Stored image has been uploaded to Supabase and linked to this Smart Listing in Neon.</p></div><div className="pairing-table"><div className="pairing-head"><span>#</span><span>FRONT</span><span>SIDE</span><span>DETAIL</span><span>BACK</span><span>STATUS</span></div>{Array.from({ length: count }, (_, index) => <div className="pairing-row" key={index}><b>{String(index + 1).padStart(3, "0")}</b>{(["front", "side", "detail", "back"] as ImageRole[]).map(role => images[role][index] ? <span className="paired-file" key={role}>{images[role][index].file.name}</span> : <span className="missing-file" key={role}>—</span>)}<em className={images.front[index]?.stored ? "row-ready" : "row-missing"}>{images.front[index]?.stored ? "Stored" : "Needs front"}</em></div>)}</div></section></>;
}

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
  return <><div className="section-title"><div><p className="eyebrow-orange">STEP 03</p><h2>Product titles, descriptions &amp; pricing</h2><p>AI creates drafts only. Every title, description, MRP, Meesho price, and inventory value is required. Wrong / defective return price is optional.</p></div><button type="button" className="primary generate-btn" onClick={() => void generate()} disabled={generating}>{generating ? "Generating…" : "✦ Generate titles & descriptions"}</button></div><section className="pricing-workspace"><div className="pricing-heading"><div><strong>Product titles</strong><span>Add clear, keyword-rich titles for every catalog item.</span></div><span>Apply seller-entered prices and inventory to every item. You can still edit any item below.</span></div><div className="pricing-columns"><span>#</span><span>TITLE *</span><span>MRP * ⓘ</span><span>MEESHO PRICE * ⓘ</span><span>WRONG / DEFECTIVE</span><span>INVENTORY *</span></div><div className="base-price-row"><span>All Items</span><span className="base-price-note">Titles are set per item</span><input aria-label="Apply MRP to all" type="number" min="1" placeholder="MRP" onChange={event => applyBase("mrp", event.target.value)} /><input aria-label="Apply Meesho price to all" type="number" min="1" placeholder="Selling price" onChange={event => applyBase("meeshoPrice", event.target.value)} /><input aria-label="Apply return price to all (optional)" type="number" min="1" placeholder="Optional" onChange={event => applyBase("defectivePrice", event.target.value)} /><input aria-label="Apply inventory to all" type="number" min="1" placeholder="Inventory" onChange={event => applyBase("inventory", event.target.value)} /></div>{items.map(item => <div className="content-price-row" key={item.id}><b>{item.position}</b><input required aria-required="true" value={item.title || ""} maxLength={100} placeholder={`Title for item ${item.position}`} onChange={event => update(item.id, "title", event.target.value)} /><input required aria-required="true" type="number" min="1" value={numberValue(item.mrp)} onChange={event => update(item.id, "mrp", event.target.value)} /><input required aria-required="true" type="number" min="1" value={numberValue(item.meeshoPrice)} onChange={event => update(item.id, "meeshoPrice", event.target.value)} /><input aria-label={`Optional wrong or defective return price for item ${item.position}`} type="number" min="1" value={numberValue(item.defectivePrice)} onChange={event => update(item.id, "defectivePrice", event.target.value)} /><input required aria-required="true" type="number" min="1" value={numberValue(item.inventory)} onChange={event => update(item.id, "inventory", event.target.value)} /></div>)}</section><section className="description-workspace"><div className="description-heading"><div><h3>Product descriptions <span className="red-asterisk">*</span></h3><p>Expand every item to review or edit the required seller-reviewed description.</p></div><button type="button" className="secondary save-content-btn" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "💾 Save content & prices"}</button></div>{items.map(item => <article className="description-row" key={item.id}><button type="button" className="description-toggle" onClick={() => setExpanded(current => current === item.id ? null : item.id)}><b>{item.position}</b><span className="description-preview"><strong>{item.title || `Item ${item.position}`}</strong><small>{item.description ? item.description.replace(/\s+/g, " ").slice(0, 180) : "Description needed."}</small></span><i>{expanded === item.id ? "⌃" : "⌄"}</i></button>{expanded === item.id && <textarea required aria-required="true" value={item.description || ""} maxLength={1500} placeholder="Enter a marketplace-safe description" onChange={event => update(item.id, "description", event.target.value)} />}</article>)}</section></>;
}

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
  return <><div className="section-title"><div><p className="eyebrow-orange">STEP 04</p><h2>Every item receives a unique SKU</h2><p>These exact stored IDs are used again on Review and by the ListingKing extension.</p></div></div><div className="sku-list">{items.map(item => <label key={item.id}><span>{String(item.position).padStart(2, "0")}</span>{editingId === item.id ? <input value={editValue} onChange={event => setEditValue(event.target.value)} autoFocus /> : <input value={item.sku || "SKU pending"} readOnly />}{editingId === item.id ? <span className="sku-actions"><button className="primary" onClick={() => void saveEdit(item.id)} disabled={saving}>{saving ? "…" : "Save"}</button><button className="secondary" onClick={cancelEdit} disabled={saving}>✕</button></span> : <span className="sku-actions"><button className="secondary" onClick={() => startEdit(item)}>Edit</button><em>● Available</em></span>}</label>)}</div></>;
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
  return <><div className="section-title"><div><p className="eyebrow-orange">STEP 05</p><h2>Review &amp; save as ready</h2><p>Check each generated title, description, price, SKU, and image count before making this listing Ready for the extension.</p></div></div><div className="review-grid"><div><small>TEMPLATE</small><strong>{reviewTemplate}</strong><span>Meesho only</span></div><div><small>ITEMS</small><strong>{items.length || count}</strong><span>Seller-reviewed data</span></div><div><small>FRONT IMAGES</small><strong>{items.filter(item => item.images?.some(image => image.role === "FRONT")).length}/{items.length || count}</strong><span>Stored in Supabase</span></div></div><div className={`review-items ${reviewStyles.items}`}>{items.map(item => <article key={item.id}><b>{String(item.position).padStart(2, "0")}</b><div className={reviewStyles.content}><strong>{item.title || `Item ${item.position}`}</strong><p>{item.description || "No description saved."}</p><dl><div><dt>MRP</dt><dd>₹{item.mrp ?? "—"}</dd></div><div><dt>Meesho price</dt><dd>₹{item.meeshoPrice ?? "—"}</dd></div><div><dt>Defective return</dt><dd>₹{item.defectivePrice ?? "—"}</dd></div></dl></div><code>{item.sku || "SKU pending"}</code></article>)}</div><div className="safe-note"><b>⚡</b> Saving this listing marks it as Ready. The ListingKing extension on Meesho will use this exact data to fill catalogs automatically.</div></>;
}
