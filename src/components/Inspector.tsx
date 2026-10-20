import { Suspense, lazy, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react';
import type { Region } from '../types';
import { currentTemplate, useStore } from '../store';
import { TEMPLATES, TEXT_TEMPLATE_ID, sortedRegions } from '../templates';
import { parseSvgToTemplate } from '../lib/svgImport';
import { About } from './About';
import { Controls } from './Controls';
import { RegionCard } from './RegionCard';
import { Toolbar } from './Toolbar';

/* Typesetting code only loads once the text template is in use. A failed
   chunk (offline, or a stale tab after a deploy) says so instead of
   crashing the whole app through an unhandled lazy rejection. */
const TextPanel = lazy(() =>
  import('./TextPanel')
    .then((m) => ({ default: m.TextPanel }))
    .catch(() => ({
      default: () => (
        <p className="num leading-snug">
          Could not load the text controls (x_x) — check your connection and reload. The canvas
          still shows the last text that was typeset.
        </p>
      ),
    })),
);

export type Tab = 'shape' | 'regions' | 'look' | 'export';

const TABS: { id: Tab; label: string }[] = [
  { id: 'shape', label: 'Shape' },
  { id: 'regions', label: 'Regions' },
  { id: 'look', label: 'Look' },
  { id: 'export', label: 'Export' },
];

/* Tailwind's lg breakpoint. Phones show one tab panel; desktop stacks them. */
const DESKTOP = '(min-width: 1024px)';
const subscribeDesktop = (cb: () => void) => {
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const isDesktop = () => window.matchMedia(DESKTOP).matches;

/** Segmented tabs for phones; lives in the sticky stage wrapper in App. */
export function InspectorTabs({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  // Roving focus per the APG tabs pattern: arrows move and select.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = TABS.findIndex((t) => t.id === tab);
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % TABS.length
        : e.key === 'ArrowLeft'
          ? (i - 1 + TABS.length) % TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? TABS.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    onTab(TABS[next].id);
    document.getElementById(`tab-${TABS[next].id}`)?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="Controls"
      className="grid grid-cols-4 border-b border-line bg-panel lg:hidden"
      onKeyDown={onKeyDown}
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          id={`tab-${t.id}`}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          aria-controls={`panel-${t.id}`}
          tabIndex={tab === t.id ? 0 : -1}
          className="tab"
          onClick={() => onTab(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * `ready` is false for the first paint: the shell reserves the column (or the
 * phone panel area) and the real controls mount in a transition right after,
 * so React time-slices them instead of blocking the stage's first frame.
 */
export function Inspector({ tab, ready }: { tab: Tab; ready: boolean }) {
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop);

  const template = useStore(currentTemplate);
  const templateId = useStore((s) => s.composition.templateId);
  const customTemplate = useStore((s) => s.customTemplate);
  const textSpec = useStore((s) => s.textSpec);
  const setTemplate = useStore((s) => s.setTemplate);
  const setCustomTemplate = useStore((s) => s.setCustomTemplate);
  const setTextTemplate = useStore((s) => s.setTextTemplate);
  const toast = useStore((s) => s.toast);

  const svgRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [typesetting, setTypesetting] = useState(false);

  const regions = sortedRegions(template);
  const isText = templateId === TEXT_TEMPLATE_ID;

  async function onSvgPicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setReading(true);
    try {
      const text = await file.text();
      const parsed = parseSvgToTemplate(text, file.name.replace(/\.svg$/i, ''));
      setCustomTemplate(parsed);
      toast(
        'ok',
        'Custom template loaded',
        `${file.name} — ${parsed.regions.length} region${parsed.regions.length === 1 ? '' : 's'}`,
      );
    } catch (err) {
      toast(
        'error',
        `Could not use ${file.name}`,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setReading(false);
    }
  }

  /* Text already typeset: just switch to it, never throw the words away. */
  async function onTextClicked() {
    if (customTemplate && customTemplate.id === TEXT_TEMPLATE_ID && textSpec) {
      if (!isText) setTemplate(TEXT_TEMPLATE_ID);
      return;
    }
    setTypesetting(true);
    try {
      const { BUILTIN_FONTS, buildTextTemplate, defaultTextSpec, loadFont } = await import(
        '../lib/textTemplate'
      );
      const spec = defaultTextSpec();
      const font =
        BUILTIN_FONTS.find((f) => f.id === spec.fontId) ?? BUILTIN_FONTS[0];
      if (!font) throw new Error('No font is available to typeset with.');
      const loaded = await loadFont(font);
      const next = { ...spec, fontId: font.id };
      setTextTemplate(buildTextTemplate(next, loaded), next);
    } catch (err) {
      toast(
        'error',
        'Could not start a text template',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setTypesetting(false);
    }
  }

  const shape = (
    <>
      <Section title="Template" note={template.name}>
        <nav aria-label="Template picker" className="grid grid-cols-2 gap-2">
          {TEMPLATES.map((t) => (
            <TemplatePill
              key={t.id}
              label={t.name}
              active={templateId === t.id}
              onClick={() => setTemplate(t.id)}
            />
          ))}

          {customTemplate ? (
            <TemplatePill
              label={customTemplate.name || 'Custom'}
              active={templateId === customTemplate.id}
              onClick={() => setTemplate(customTemplate.id)}
            />
          ) : null}

          <button
            type="button"
            className="btn w-full min-w-0"
            disabled={typesetting}
            aria-pressed={isText}
            onClick={() => void onTextClicked()}
          >
            <span className="truncate">{typesetting ? 'Typesetting…' : 'Text'}</span>
          </button>

          <button
            type="button"
            className="btn w-full min-w-0"
            disabled={reading}
            onClick={() => svgRef.current?.click()}
          >
            <span className="truncate">
              {reading ? 'Reading…' : customTemplate ? 'Replace SVG' : 'Custom SVG'}
            </span>
          </button>
        </nav>

        <input
          ref={svgRef}
          type="file"
          accept=".svg,image/svg+xml"
          className="sr-only"
          tabIndex={-1}
          aria-label="Upload an SVG shape"
          onChange={onSvgPicked}
        />

        {!customTemplate ? (
          <p className="num mt-3 leading-snug">
            no custom shape yet — any SVG with separate paths will do (・o・)
          </p>
        ) : null}
      </Section>

      {isText ? (
        <Section
          className="cv-auto"
          title="Text"
          note={textSpec ? `${textSpec.split} split` : 'not typeset'}
        >
          {textSpec ? (
            <Suspense fallback={<p className="num leading-snug">loading the typesetter…</p>}>
              <TextPanel />
            </Suspense>
          ) : (
            <p className="num leading-snug">
              This template came from text, but the run that made it was not saved with it. Pick
              Text again to typeset a fresh one.
            </p>
          )}
        </Section>
      ) : null}
    </>
  );

  const output = (
    <Section className="cv-auto" title="Output">
      <Toolbar />
    </Section>
  );

  const regionSection = (
    <Section
      className="cv-auto"
      title="Regions"
      note={`${regions.length} in paint order`}
      subtitle="drop an image on a region and it fills. that easy."
    >
      {regions.length === 0 ? (
        <p className="num leading-snug">
          This template has no regions, so there is nothing to fill.
        </p>
      ) : (
        <RegionList regions={regions} />
      )}
    </Section>
  );

  const look = (
    <Section className="cv-auto" title="Composition">
      <Controls />
    </Section>
  );

  const about = (
    <div className="px-5 py-7">
      <About />
    </div>
  );

  const panels: Record<Tab, ReactNode> = {
    shape,
    regions: regionSection,
    look,
    export: (
      <>
        {output}
        {about}
      </>
    ),
  };

  return (
    <aside
      aria-label="Inspector"
      id="inspector"
      className="scroll-thin flex w-full min-w-0 shrink-0 flex-col overflow-x-hidden overflow-y-auto border-t border-line bg-panel max-lg:min-h-[50svh] max-lg:border-t-0 lg:h-full lg:min-h-0 lg:w-[360px] lg:border-t-0 lg:border-l"
    >
      {!ready ? null : desktop ? (
        <>
          {shape}
          {output}
          {regionSection}
          {look}
          {about}
        </>
      ) : (
        // Inactive panels stay as empty shells so every tab's aria-controls
        // resolves, without rendering their controls.
        TABS.map((t) => (
          <div
            key={t.id}
            id={`panel-${t.id}`}
            role="tabpanel"
            aria-labelledby={`tab-${t.id}`}
            hidden={t.id !== tab}
          >
            {t.id === tab ? panels[t.id] : null}
          </div>
        ))
      )}
    </aside>
  );
}

const COLLAPSED_COUNT = 12;

/* Owns the fills subscription so a drag re-renders this list (and, through
   memo, only the dragged region's card) rather than the whole Inspector. */
function RegionList({ regions }: { regions: Region[] }) {
  const fills = useStore((s) => s.composition.fills);
  const selectedId = useStore((s) => s.selectedId);
  const [expanded, setExpanded] = useState(false);

  /* Bring the selected card into view — on a phone, below the sticky stage,
     which scrollIntoView knows nothing about. Ids are untrusted, so escape. */
  useEffect(() => {
    if (!selectedId) return;
    const card = document.querySelector<HTMLElement>(
      `[data-region-card="${CSS.escape(selectedId)}"]`,
    );
    if (!card) return;
    if (isDesktop()) {
      card.scrollIntoView({ block: 'nearest' });
      return;
    }
    const stage = document.querySelector('[data-sticky-stage]')?.getBoundingClientRect();
    const r = card.getBoundingClientRect();
    if (stage && r.top >= stage.bottom && r.bottom <= window.innerHeight) return;
    // Once scrolled, the stage sticks at top:0, so its height is where art ends.
    const top = stage?.height ?? 0;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollBy({ top: r.top - top - 8, behavior: still ? 'auto' : 'smooth' });
  }, [selectedId]);

  const collapsible = regions.length > COLLAPSED_COUNT;
  const shown =
    !collapsible || expanded
      ? regions
      : regions.filter((r, i) => i < COLLAPSED_COUNT || r.id === selectedId);

  return (
    <div className="flex flex-col gap-2">
      {shown.map((region) => (
        <RegionCard key={region.id} region={region} fill={fills[region.id]} />
      ))}
      {collapsible ? (
        <button
          type="button"
          className="btn w-full"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'show fewer' : `show all ${regions.length} regions`}
        </button>
      ) : null}
    </div>
  );
}

function Section({
  title,
  note,
  subtitle,
  className = '',
  children,
}: {
  title: string;
  className?: string;
  note?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className={`border-b border-line px-5 py-7 last:border-b-0 ${className}`}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-mono text-[10px] tracking-[0.14em] text-muted uppercase">{title}</h2>
        {note ? <span className="num truncate">{note}</span> : null}
      </div>
      {subtitle ? <p className="num mb-3 leading-snug">{subtitle}</p> : null}
      {children}
    </section>
  );
}

function TemplatePill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`btn w-full ${active ? 'btn-accent' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="truncate">{label}</span>
    </button>
  );
}
