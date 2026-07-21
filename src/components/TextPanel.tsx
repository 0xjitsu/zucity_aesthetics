import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { FontAsset, TextSpec, TextSplit } from '../types';
import { useStore } from '../store';
import {
  BUILTIN_FONTS,
  buildTextTemplate,
  defaultTextSpec,
  fontFromFile,
  loadFont,
} from '../lib/textTemplate';
import { SliderRow } from './Controls';

/* --------------------------------------------------------------------------
   Text as a template.

   Every spec change re-runs loadFont -> buildTextTemplate and installs the
   result. Two things make that safe:

   1. Continuous controls (the textarea, the sliders) go through a TRAILING
      debounce. A range input fires onChange on every pixel of a drag and
      setTextTemplate records history, so an undebounced rebuild would flush
      the 30-step undo history in one drag — the same trap SliderRow guards
      against. Trailing means a whole drag, or a whole burst of typing, costs
      one rebuild and one undo step.
   2. Font loading is async and the Japanese face is 2.3 MB, so a slow load
      can land after a newer one. Every rebuild takes a ticket and drops its
      result if a newer rebuild has started since.
   -------------------------------------------------------------------------- */

const DEBOUNCE_MS = 250;

/** Kana, kanji, and halfwidth katakana — enough to spot "wrong font" cheaply. */
const CJK = /[぀-ヿㇰ-ㇿ一-鿿ｦ-ﾟ]/;
const COVERS_CJK = /japan|cjk|kana|kanji|katakana|hiragana|gothic|zen/i;

/** The em size the module ships with, used to scale the slider ranges. */
let sizeBaseline: number | null = null;
function baseSize(): number {
  if (sizeBaseline !== null) return sizeBaseline;
  const n = defaultTextSpec().fontSize;
  const value: number = Number.isFinite(n) && n > 0 ? n : 12;
  sizeBaseline = value;
  return value;
}

/** viewBox units, at whatever precision the em size makes readable. */
function units(v: number): string {
  const size = baseSize();
  if (size >= 40) return String(Math.round(v));
  if (size >= 4) return v.toFixed(1);
  return v.toFixed(3);
}

function reasonOf(err: unknown): string {
  if (err && typeof err === 'object' && 'reason' in err) {
    const reason = (err as { reason?: unknown }).reason;
    if (typeof reason === 'string' && reason.length > 0) return reason;
  }
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

const SPLIT_HINT: Record<TextSplit, string> = {
  glyph: 'Every character becomes its own fillable region.',
  line: 'Every line becomes one fillable region.',
  all: 'The whole run stays a single fillable region.',
};

export function TextPanel() {
  const storeSpec = useStore((s) => s.textSpec);
  const uploadedFonts = useStore((s) => s.fonts);
  const regionCount = useStore((s) => s.customTemplate?.regions.length ?? null);
  const setTextTemplate = useStore((s) => s.setTextTemplate);
  const addFont = useStore((s) => s.addFont);
  const toast = useStore((s) => s.toast);

  const [draft, setDraft] = useState<TextSpec>(() => storeSpec ?? defaultTextSpec());
  const draftRef = useRef(draft);
  /** The last spec this panel handed to the store, so undo/open can be told apart. */
  const submitted = useRef<TextSpec | null>(storeSpec);
  const ticket = useRef(0);
  const timer = useRef<number | null>(null);

  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fontInput = useRef<HTMLInputElement>(null);
  const textId = useId();
  const fontId = useId();

  const fonts = listFonts(uploadedFonts);
  const selectedFont = fonts.find((f) => f.id === draft.fontId);
  const base = baseSize();

  /* An outside change — undo, or opening a document — replaces the draft. */
  useEffect(() => {
    if (storeSpec && storeSpec !== submitted.current) {
      submitted.current = storeSpec;
      draftRef.current = storeSpec;
      setDraft(storeSpec);
      setError(null);
    }
  }, [storeSpec]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  async function rebuild(next: TextSpec) {
    const mine = ++ticket.current;
    const font = fonts.find((f) => f.id === next.fontId);
    if (!font) {
      const detail = `The font this text asks for (${next.fontId}) is not loaded. Pick another, or upload the original.`;
      setError(detail);
      toast('error', 'Font not available', detail);
      return;
    }

    setBusy(true);
    try {
      const loaded = await loadFont(font);
      if (mine !== ticket.current) return;
      const template = buildTextTemplate(next, loaded);
      if (mine !== ticket.current) return;
      submitted.current = next;
      setTextTemplate(template, next);
      setError(null);
    } catch (err) {
      if (mine !== ticket.current) return;
      const detail = reasonOf(err);
      setError(detail);
      toast('error', 'The text was not rebuilt', detail);
    } finally {
      if (mine === ticket.current) setBusy(false);
    }
  }

  /**
   * `settle` is for continuous controls; discrete ones rebuild immediately so
   * a click on Vertical feels like a click on Vertical.
   */
  function apply(patch: Partial<TextSpec>, mode: 'now' | 'settle') {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (mode === 'now') {
      void rebuild(next);
    } else {
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void rebuild(next);
      }, DEBOUNCE_MS);
    }
  }

  async function onFontPicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const font = await fontFromFile(file);
      addFont(font);
      toast('ok', 'Font added', `${font.name} is now in the picker.`);
      apply({ fontId: font.id }, 'now');
    } catch (err) {
      const detail = reasonOf(err);
      setError(detail);
      toast('error', `Could not use ${file.name}`, detail);
    } finally {
      setUploading(false);
    }
  }

  const mismatch =
    CJK.test(draft.text) && selectedFont ? !COVERS_CJK.test(selectedFont.coverage ?? '') : false;

  return (
    <div className="flex flex-col gap-1">
      {/* The reason anyone opened this panel. */}
      <div className="pb-1">
        <label htmlFor={textId} className="label">
          Words
        </label>
        <textarea
          id={textId}
          className="mt-2 block max-h-[60vh] min-h-[132px] w-full resize-y border border-line bg-raise p-3 font-mono text-[15px] leading-[1.35] tracking-[0.06em] text-ink"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="Type here"
          value={draft.text}
          onChange={(e) => apply({ text: e.target.value }, 'settle')}
        />
        <p className="num mt-2 leading-snug">
          {draft.text.trim().length === 0
            ? 'Nothing typed yet — the shape is empty until you write something.'
            : regionCount === null
              ? 'Not built into regions yet.'
              : `${regionCount} fillable region${regionCount === 1 ? '' : 's'} from this run.`}
        </p>
      </div>

      {error ? (
        <div className="my-2 border border-accent-dim bg-accent/5 px-3 py-2.5">
          <p className="label text-accent">Text not rebuilt</p>
          <p className="mt-1.5 text-[12px] leading-snug text-ink">{error}</p>
          <p className="num mt-1.5 leading-snug">
            The canvas is still showing the last run that worked.
          </p>
        </div>
      ) : null}

      <div className="my-3 border-t border-line-soft" />

      {/* Font. Coverage is spelled out because a Latin face on Japanese text is
          the single most likely way to end up with an empty canvas. */}
      <div className="py-2">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={fontId} className="label">
            Font
          </label>
          {busy ? <span className="num text-accent">Loading…</span> : null}
        </div>
        <select
          id={fontId}
          aria-label="Font for the text template"
          className="mt-2 min-h-11 w-full"
          value={draft.fontId}
          onChange={(e) => apply({ fontId: e.target.value }, 'now')}
        >
          {fonts.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} — {f.coverage ?? 'coverage not declared'}
            </option>
          ))}
          {!selectedFont ? (
            <option value={draft.fontId}>{draft.fontId} — not loaded</option>
          ) : null}
        </select>

        <p className="num mt-2 leading-snug">
          {!selectedFont
            ? 'This text was built with a font that is not loaded. Pick one above, or upload the original.'
            : busy
              ? `Reading ${selectedFont.name}. Japanese faces are large, so the first load takes a moment.`
              : (selectedFont.coverage ?? 'This font does not declare what it covers.')}
        </p>

        {mismatch ? (
          <p className="mt-2 border-l border-accent pl-3 text-[12px] leading-snug text-ink">
            There is Japanese in your text but {selectedFont?.name} does not declare Japanese
            coverage. Expect missing glyphs — switch to a face that covers kana and kanji.
          </p>
        ) : null}

        <input
          ref={fontInput}
          type="file"
          accept=".ttf,.otf,.woff,font/*"
          className="sr-only"
          tabIndex={-1}
          onChange={onFontPicked}
        />
        <button
          type="button"
          className="btn mt-3 w-full"
          disabled={uploading}
          onClick={() => fontInput.current?.click()}
        >
          {uploading ? 'Reading font…' : 'Upload a font'}
        </button>
      </div>

      <div className="my-3 border-t border-line-soft" />

      <SliderRow
        label="Size"
        value={draft.fontSize}
        min={base * 0.25}
        max={base * 4}
        step={base / 200}
        format={(v) => `${units(v)} u`}
        onChange={(fontSize) => apply({ fontSize }, 'settle')}
      />

      <SliderRow
        label="Letter spacing"
        value={draft.letterSpacing}
        min={-base * 0.3}
        max={base * 1.2}
        step={base / 400}
        format={(v) => (v === 0 ? 'None' : `${units(v)} u`)}
        onChange={(letterSpacing) => apply({ letterSpacing }, 'settle')}
      />

      <SliderRow
        label="Line height"
        value={draft.lineHeight}
        min={0.6}
        max={2.6}
        step={0.01}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={(lineHeight) => apply({ lineHeight }, 'settle')}
      />

      <div className="my-3 border-t border-line-soft" />

      <Segmented
        label="Direction"
        columns={2}
        value={draft.direction}
        options={[
          { value: 'horizontal', label: 'Horizontal' },
          { value: 'vertical', label: 'Vertical' },
        ]}
        hint={
          draft.direction === 'vertical'
            ? 'The CJK setting: glyphs stack downward and columns run right to left.'
            : 'Lines run left to right, stacked top to bottom.'
        }
        onChange={(direction) => apply({ direction }, 'now')}
      />

      <Segmented
        label="Align"
        columns={3}
        value={draft.align}
        options={[
          { value: 'start', label: 'Start' },
          { value: 'center', label: 'Center' },
          { value: 'end', label: 'End' },
        ]}
        hint={
          draft.direction === 'vertical'
            ? 'Where short columns sit against the tall ones.'
            : 'Where short lines sit against the long ones.'
        }
        onChange={(align) => apply({ align }, 'now')}
      />

      <Segmented
        label="Split"
        columns={3}
        value={draft.split}
        options={[
          { value: 'glyph', label: 'Glyph' },
          { value: 'line', label: 'Line' },
          { value: 'all', label: 'Whole' },
        ]}
        hint={`This decides how many regions you get to fill. ${SPLIT_HINT[draft.split]}`}
        onChange={(split) => apply({ split }, 'now')}
      />

      <div className="mt-4 border border-line-soft bg-raise px-3 py-3">
        <p className="label">Filling the letterforms</p>
        <p className="mt-1.5 text-[12px] leading-snug text-muted">
          Drop an image straight onto a glyph card below and it fills that one glyph. To run a
          single photograph through every letter, fill one and use “Apply to every region”.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Built-ins first, then uploads, deduped by id. */
function listFonts(uploaded: Record<string, FontAsset>): FontAsset[] {
  const seen = new Set(BUILTIN_FONTS.map((f) => f.id));
  const extra = Object.values(uploaded).filter((f) => !seen.has(f.id));
  return [...BUILTIN_FONTS, ...extra];
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  hint: string;
  columns: 2 | 3;
  onChange: (v: T) => void;
}

function Segmented<T extends string>({
  label,
  value,
  options,
  hint,
  columns,
  onChange,
}: SegmentedProps<T>) {
  const id = useId();
  return (
    <div className="py-2">
      <p id={id} className="label">
        {label}
      </p>
      <div
        role="group"
        aria-labelledby={id}
        className={`mt-2 grid gap-2 ${columns === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`btn w-full min-w-0 ${value === o.value ? 'btn-accent' : ''}`}
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
          >
            <span className="truncate">{o.label}</span>
          </button>
        ))}
      </div>
      <p className="num mt-2 leading-snug">{hint}</p>
    </div>
  );
}
