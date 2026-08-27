'use client';

/**
 * Content Creator — "Add your own image".
 *
 * Optional throughout: a composition with no uploaded image behaves exactly as
 * it did before this panel existed.
 *
 * The flow is upload → choose usage → attached, and the choice of usage is the
 * point. The same photograph is the subject of one design, the background of
 * another and a style reference in a third, so the user states the intent
 * rather than the system guessing it from the pixels.
 *
 * Storage is untouched: the file goes through the EXISTING `/api/media/upload`
 * path, and `/api/creator-assets/composition` then registers it as a canonical
 * media asset and records how it is used. This component holds no asset state
 * of its own — it re-reads from the server, which is why the selection survives
 * navigating to the template gallery and back.
 *
 * The usages offered are the ones the ACTIVE TEMPLATE declares it accepts — not
 * the full vocabulary. Offering all six regardless of template is what let an
 * attach look successful while routing discarded the reference at generation.
 */

import React from 'react';
import { Upload, Trash2, RefreshCw, ImagePlus, AlertCircle, Loader2 } from 'lucide-react';
import { getSupabaseBrowser } from '../../lib/supabaseBrowser';
import {
  creatorAssetUsageLabel,
  creatorAssetUsageOptionsForTemplate,
  templateAcceptsAttachedReference,
} from '../../lib/content/creatorCompositionAsset';
import type { CompositionAssetMode, CompositionAssetPurpose } from '../../lib/content/compositionAssetReference';
import type { TemplateAssetSlot } from '../../lib/content/compositionAssetRouting';
import {
  proposeImageTreatment,
  describeTreatment,
  EMPTY_GUIDED_CHOICES,
  type GuidedCreativeChoices,
} from '../../lib/content/guidedCreativeDirection';

interface AttachedItem {
  reference: {
    id: string;
    assetId: string;
    purpose: CompositionAssetPurpose;
    mode: CompositionAssetMode;
    ordinal: number;
  };
  asset: { id: string; sourceUrl: string | null; originalFilename: string | null } | null;
}

const ENDPOINT = '/api/creator-assets/composition';

export default function CreatorImageAssetPanel({
  companyId,
  compositionId,
  creatorTypeLabel,
  templateSlots,
  templateName,
  templateCategory,
  assetFamily,
  templatePurposeKey,
  guidedChoices,
  brief,
  onAttachmentChange,
}: {
  companyId: string | null | undefined;
  compositionId: string | null;
  creatorTypeLabel: string;
  /** The ACTIVE template's declared slots. They decide what may be offered. */
  templateSlots?: readonly TemplateAssetSlot[] | null;
  templateName?: string | null;
  /** Category + purpose key let the proposal read the design's own contract. */
  templateCategory?: string | null;
  /**
   * Which family is being made.
   *
   * Decides how a treatment is DESCRIBED, never how it routes. An infographic
   * places a background deterministically where an image conditions a model on
   * it, and telling both users the same sentence would make one of them false.
   */
  assetFamily?: 'image' | 'carousel' | 'infographic' | null;
  templatePurposeKey?: string | null;
  /** The user's creative answers — what they said should be featured, and the look. */
  guidedChoices?: GuidedCreativeChoices | null;
  /** The brief, read only as a signal for the proposal. */
  brief?: string | null;
  /**
   * Reports the attachment as it actually stands, so the pre-generation summary
   * can state what will happen to the user's picture.
   *
   * The panel already holds the truth — it loaded the references — so telling
   * the parent is cheaper and more honest than having the parent fetch the same
   * rows again and risk disagreeing with what is on screen.
   */
  onAttachmentChange?: (attachment: {
    filename: string | null;
    purpose: CompositionAssetPurpose;
    placedExactly: boolean;
  } | null) => void;
}) {
  const [items, setItems] = React.useState<AttachedItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  /** Set while the user is choosing a usage for a file already uploaded. */
  const [pendingMediaFileId, setPendingMediaFileId] = React.useState<string | null>(null);
  const [pendingPreview, setPendingPreview] = React.useState<string | null>(null);
  /**
   * The attachment this upload is replacing, captured when Replace was pressed.
   *
   * Held across the usage choice because the usage may differ from the one the
   * old image had — and it is precisely that case where the old reference would
   * otherwise survive under its previous purpose, invisible to a panel that
   * shows a single image and still reaching the render.
   */
  const [replacingReferenceId, setReplacingReferenceId] = React.useState<string | null>(null);
  /**
   * What the user told us about this image, in their words.
   *
   * Asked once, right after the upload, while they are still thinking about the
   * picture — not buried behind an "advanced" disclosure. The six usages cover
   * the common cases; a sentence covers the one the user actually has.
   */
  const [instruction, setInstruction] = React.useState('');
  /**
   * The user asked us to pick the treatment.
   *
   * No composition reference exists while this is true — the upload is held,
   * exactly as it is held while they read the usage buttons. A reference is
   * created only once a concrete treatment is accepted, so nothing is ever
   * persisted with a purpose the user did not agree to.
   */
  const [letUsChoose, setLetUsChoose] = React.useState(false);
  const instructionRef = React.useRef<HTMLInputElement | null>(null);

  const ready = Boolean(companyId && compositionId);

  /* Only what the active template actually accepts. Deriving this here — from
   * the template's own slots — is what stops the panel offering a usage that
   * routing would discard, which is what made an attach look successful while
   * generation ignored it. */
  const usageOptions = React.useMemo(
    () => creatorAssetUsageOptionsForTemplate(templateSlots),
    [templateSlots],
  );
  const templateAcceptsAssets = usageOptions.length > 0;

  /* The server is the source of truth. Re-reading on mount is what makes the
   * selection survive a trip to the template gallery — nothing is cached here. */
  const load = React.useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${ENDPOINT}?company_id=${encodeURIComponent(companyId!)}&composition_id=${encodeURIComponent(compositionId!)}`,
        { credentials: 'include' },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) setItems(Array.isArray(data?.items) ? data.items : []);
    } catch {
      /* transient — keep whatever is on screen rather than blanking it */
    } finally {
      setLoading(false);
    }
  }, [ready, companyId, compositionId]);

  React.useEffect(() => { void load(); }, [load]);

  /** Upload through the existing media path. Returns the media_files id. */
  const uploadFile = async (file: File): Promise<{ id: string; url: string } | null> => {
    const { data: { user } } = await getSupabaseBrowser().auth.getUser();
    if (!user?.id) { setError('Please sign in again to upload an image.'); return null; }

    const fd = new FormData();
    fd.append('file', file);
    fd.append('user_id', user.id);
    // Dimensions are read in the browser because the upload service records
    // whatever it is given and never decodes the image itself.
    const dims = await readImageDimensions(file).catch(() => null);
    if (dims) { fd.append('width', String(dims.width)); fd.append('height', String(dims.height)); }

    const res = await fetch('/api/media/upload', { method: 'POST', credentials: 'include', body: fd });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json?.error || json?.message || 'Upload failed.');
      return null;
    }
    const id = json?.data?.id ? String(json.data.id) : '';
    if (!id) { setError('Upload succeeded but the file could not be identified.'); return null; }
    // `storage_url` is the column production actually writes; `file_url` was
    // proven not to exist on media_files, so it is only a legacy fallback.
    return { id, url: String(json?.data?.storage_url || json?.data?.file_url || '') };
  };

  const onPick = async (file: File | null) => {
    if (!file || !ready) return;
    setError(null);
    if (!file.type.startsWith('image/')) { setError('Please choose an image file.'); return; }
    setBusy('upload');
    try {
      const uploaded = await uploadFile(file);
      if (!uploaded) return;
      // Held, not attached: a reference cannot exist before its usage is known,
      // and an unusable half-record is worse than an extra click.
      setPendingMediaFileId(uploaded.id);
      setPendingPreview(uploaded.url || null);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  /** Usage chosen → register the upload canonically and attach it. */
  const attach = async (purpose: CompositionAssetPurpose) => {
    if (!pendingMediaFileId || !ready) return;
    setError(null); setBusy('attach');
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId, composition_id: compositionId,
          media_file_id: pendingMediaFileId, purpose,
          replaces_reference_id: replacingReferenceId,
          instruction: instruction.trim() || null,
          ai_proposed: letUsChoose,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The file reached storage but never became a usable asset. Say so, and
        // clear the pending selection so nothing on screen implies otherwise.
        setError(data?.error || 'The image was uploaded but could not be registered.');
        setPendingMediaFileId(null); setPendingPreview(null); setReplacingReferenceId(null); setInstruction(''); setLetUsChoose(false);
        return;
      }
      setPendingMediaFileId(null); setPendingPreview(null); setReplacingReferenceId(null); setInstruction(''); setLetUsChoose(false);
      await load();
    } catch {
      setError('The image was uploaded but could not be registered.');
    } finally { setBusy(null); }
  };

  /** Change how an attached asset is used. Same file, new relationship. */
  const changeUsage = async (item: AttachedItem, purpose: CompositionAssetPurpose) => {
    if (!ready || purpose === item.reference.purpose) return;
    setError(null); setBusy(item.reference.id);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId, composition_id: compositionId,
          reference_id: item.reference.id, asset_id: item.reference.assetId, purpose,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error || 'Could not change how this image is used.');
        return;
      }
      await load();
    } finally { setBusy(null); }
  };

  /** Detach. The asset itself stays in the library — it is reusable. */
  const detach = async (item: AttachedItem) => {
    if (!ready) return;
    setError(null); setBusy(item.reference.id);
    try {
      const res = await fetch(
        `${ENDPOINT}?company_id=${encodeURIComponent(companyId!)}&reference_id=${encodeURIComponent(item.reference.id)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) { setError('Could not remove the image.'); return; }
      await load();
    } finally { setBusy(null); }
  };

  if (!ready) return null;

  const attached = items[0] ?? null;
  const choosing = Boolean(pendingMediaFileId);
  /*
   * The proposal is DERIVED from current state, never stored.
   *
   * That is what makes staleness impossible rather than merely handled: change
   * the template, the look, what's featured, or the note, and this recomputes
   * on the next render. There is no saved decision that can quietly stop
   * matching the design it was made for.
   */
  const proposal = React.useMemo(
    () => proposeImageTreatment({
      templateSlots,
      templateCategory,
      templatePurposeKey,
      subject: (guidedChoices ?? EMPTY_GUIDED_CHOICES).subject ?? null,
      visualDirectionId: (guidedChoices ?? EMPTY_GUIDED_CHOICES).visualDirectionId ?? null,
      instruction,
      brief,
      family: assetFamily,
    }),
    [templateSlots, templateCategory, templatePurposeKey, guidedChoices, instruction, brief, assetFamily],
  );

  /*
   * Does the CURRENT template accept the attachment as it stands?
   *
   * The composition outlives a template change — that is deliberate, so a trip
   * to the gallery does not cost the user their upload — which means an image
   * attached as a subject can find itself on a design that has no subject. The
   * honest thing is to say so: the reference is still there, the file is still
   * theirs, but this design will not use it. Judged by the same predicate the
   * router uses, on the relationship the reference actually has.
   */
  const attachedUsable = attached
    ? templateAcceptsAttachedReference(templateSlots, attached.reference)
    : true;

  /*
   * Tell the parent what is attached, whenever that changes.
   *
   * Reported from the loaded reference rather than from what was just sent, so
   * a failed or displaced attach cannot leave the summary claiming an image the
   * composition does not have.
   */
  React.useEffect(() => {
    if (!onAttachmentChange) return;
    onAttachmentChange(attached ? {
      filename: attached.asset?.originalFilename ?? null,
      purpose: attached.reference.purpose,
      placedExactly: attached.reference.mode === 'compose',
    } : null);
  }, [onAttachmentChange, attached]);

  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
            Your Own Image
          </p>
          <p className="mt-1 text-sm text-gray-600">
            Optional: add your own photo — a person, a product, a background — and say how it
            should be used in this {creatorTypeLabel}.
          </p>
        </div>
        {attached && !choosing ? (
          <button
            type="button"
            onClick={() => { setReplacingReferenceId(attached.reference.id); fileRef.current?.click(); }}
            disabled={Boolean(busy)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:border-gray-300 disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Replace
          </button>
        ) : null}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onPick(e.target.files?.[0] ?? null)}
      />

      {error ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* The template accepts nothing, so there is nothing honest to offer.
        * Saying so beats presenting six usages that routing would discard. */}
      {!templateAcceptsAssets && !attached ? (
        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-xs text-gray-600">
          <span className="font-semibold text-gray-800">
            {templateName ? `${templateName} ` : 'This template '}
          </span>
          doesn&rsquo;t use a reference image, so adding one here wouldn&rsquo;t
          change the design. Pick a template that accepts an image — such as the
          logo or product designs — to attach one.
        </div>
      ) : null}

      {/* Empty → the single call to action. */}
      {templateAcceptsAssets && !attached && !choosing ? (
        <button
          type="button"
          onClick={() => { setReplacingReferenceId(null); fileRef.current?.click(); }}
          disabled={busy === 'upload'}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white px-3 py-6 text-sm font-semibold text-gray-600 hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-60"
        >
          {busy === 'upload'
            ? (<><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</>)
            : (<><ImagePlus className="h-4 w-4" /> Add an image</>)}
        </button>
      ) : null}

      {/* Uploaded, awaiting its usage. The reference does not exist yet. */}
      {choosing ? (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-white p-3">
          <div className="flex items-start gap-3">
            {pendingPreview ? (
              <img src={pendingPreview} alt="" className="h-20 w-20 rounded-lg object-cover" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-gray-100">
                <Upload className="h-5 w-5 text-gray-400" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">How do you want to use this image?</p>
              {!letUsChoose ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {usageOptions.map((o) => (
                    <button
                      key={o.purpose}
                      type="button"
                      title={o.hint}
                      disabled={busy === 'attach'}
                      onClick={() => void attach(o.purpose)}
                      className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-50"
                    >
                      {o.label}
                    </button>
                  ))}
                  {/* Offered last, and only when there is something to choose
                    * between — a single acceptable usage is not a decision. */}
                  {usageOptions.length > 1 ? (
                    <button
                      type="button"
                      title="We'll pick what works best for this design."
                      disabled={busy === 'attach'}
                      onClick={() => setLetUsChoose(true)}
                      className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:border-emerald-400 disabled:opacity-50"
                    >
                      Let us choose
                    </button>
                  ) : null}
                </div>
              ) : null}
              {/* "Let us choose" — the proposal, and the three things a person
                * can do with it. Shown instead of the raw usage buttons, because
                * asking someone to pick a usage AND read a proposal at the same
                * time is the choice they already said they didn't want to make. */}
              {letUsChoose ? (
                <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-2.5 py-2">
                  {proposal.purpose ? (
                    <>
                      <p className="text-xs font-semibold text-emerald-900">
                        {describeTreatment(proposal.purpose, assetFamily).headline}
                      </p>
                      <p className="mt-1 text-[11px] leading-4 text-emerald-800">
                        {describeTreatment(proposal.purpose, assetFamily).promise}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          disabled={busy === 'attach'}
                          onClick={() => void attach(proposal.purpose!)}
                          className="rounded-lg border border-emerald-500 bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Looks right
                        </button>
                        <button
                          type="button"
                          onClick={() => setLetUsChoose(false)}
                          className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-emerald-300"
                        >
                          Use it differently
                        </button>
                        <button
                          type="button"
                          onClick={() => instructionRef.current?.focus()}
                          className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-emerald-300"
                        >
                          Tell us more
                        </button>
                      </div>
                    </>
                  ) : (
                    /* Truthful rather than a guess: we say we could not choose,
                     * and hand the decision straight back. */
                    <>
                      <p className="text-xs font-semibold text-amber-900">
                        We couldn&rsquo;t confidently choose how to use this image.
                      </p>
                      <button
                        type="button"
                        onClick={() => setLetUsChoose(false)}
                        className="mt-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-emerald-300"
                      >
                        Choose how to use it
                      </button>
                    </>
                  )}
                </div>
              ) : null}

              <label className="mt-3 block">
                <span className="text-xs font-semibold text-gray-700">
                  Anything we should know about this image?
                </span>
                <input
                  type="text"
                  ref={instructionRef}
                  value={instruction}
                  maxLength={400}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="e.g. Use me as the main person on the right"
                  className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-800 placeholder:text-gray-400 focus:border-emerald-400 focus:outline-none"
                />
                <span className="mt-1 block text-[11px] text-gray-400">
                  Optional. Skip it and we&rsquo;ll work it out from your design.
                </span>
              </label>
              <button
                type="button"
                onClick={() => { setPendingMediaFileId(null); setPendingPreview(null); setReplacingReferenceId(null); setInstruction(''); setLetUsChoose(false); }}
                className="mt-2 text-xs font-semibold text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Attached. Usage is changeable in place — no re-upload. */}
      {attached && !choosing ? (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-white p-3">
          <div className="flex items-start gap-3">
            {attached.asset?.sourceUrl ? (
              <img src={attached.asset.sourceUrl} alt="" className="h-20 w-20 rounded-lg object-cover" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-gray-100 text-[10px] text-gray-400">
                No preview
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold text-gray-900">
                  {attached.asset?.originalFilename || 'Uploaded image'}
                </p>
                <button
                  type="button"
                  onClick={() => void detach(attached)}
                  disabled={busy === attached.reference.id}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" /> Remove
                </button>
              </div>
              <p className="mt-0.5 text-xs text-gray-500">
                Using as <span className="font-semibold text-emerald-700">
                  {creatorAssetUsageLabel(attached.reference.purpose)}
                </span>
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {usageOptions.map((o) => {
                  const active = o.purpose === attached.reference.purpose;
                  return (
                    <button
                      key={o.purpose}
                      type="button"
                      title={o.hint}
                      disabled={Boolean(busy)}
                      onClick={() => void changeUsage(attached, o.purpose)}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                        active
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                          : 'border-gray-200 bg-white text-gray-700 hover:border-emerald-300'
                      }`}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          {/* What this asset actually DOES, in the user's terms.
            * The two modes are different promises and must not read alike:
            * `compose` returns their exact pixels, `condition` hands the image
            * to the model as reference and may reinterpret it. Saying "it does
            * not change the generated image" — which this said before the
            * runtime was wired — is now simply untrue. */}
          {attachedUsable ? (
            <p className="mt-2 text-[11px] text-gray-400">
              {attached.reference.mode === 'compose'
                ? 'Placed on this design as uploaded.'
                : 'Used as a reference for this design, so the result may differ from the original.'}
            </p>
          ) : (
            /* Not a warning about a mistake — a statement about this design.
             * The image is kept, and either another usage or another template
             * puts it back to work. */
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
              {templateName ? `${templateName} does not use` : 'This template does not use'} an
              image as {creatorAssetUsageLabel(attached.reference.purpose).toLowerCase()}, so it
              will not appear in what you generate.{' '}
              {usageOptions.length > 0
                ? 'Choose one of the usages above, or remove it — the image stays in your library either way.'
                : 'Pick a template that accepts an image, or remove it — the image stays in your library either way.'}
            </p>
          )}
        </div>
      ) : null}

      {loading && !attached && !choosing ? (
        <p className="mt-2 text-xs text-gray-400">Loading…</p>
      ) : null}
    </div>
  );
}

/** Decode just enough of the file to record real dimensions. */
function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const dims = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      dims.width && dims.height ? resolve(dims) : reject(new Error('no dimensions'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}
