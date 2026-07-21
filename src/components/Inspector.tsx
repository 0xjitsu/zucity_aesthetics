import { useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { currentTemplate, useStore } from '../store';
import { TEMPLATES, TEXT_TEMPLATE_ID, sortedRegions } from '../templates';
import { parseSvgToTemplate } from '../lib/svgImport';
import { BUILTIN_FONTS, buildTextTemplate, defaultTextSpec, loadFont } from '../lib/textTemplate';
import { Controls } from './Controls';
import { RegionCard } from './RegionCard';
import { TextPanel } from './TextPanel';
import { Toolbar } from './Toolbar';

export function Inspector() {
  const template = useStore(currentTemplate);
  const templateId = useStore((s) => s.composition.templateId);
  const fills = useStore((s) => s.composition.fills);
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

  return (
    <aside
      aria-label="Inspector"
      id="inspector"
      className="scroll-thin flex w-full min-w-0 shrink-0 flex-col overflow-x-hidden overflow-y-auto border-t border-line bg-panel lg:h-full lg:min-h-0 lg:w-[360px] lg:border-t-0 lg:border-l"
    >
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
          onChange={onSvgPicked}
        />

        {!customTemplate ? (
          <p className="num mt-3 leading-snug">
            No custom template loaded. Any SVG with separate paths will do.
          </p>
        ) : null}
      </Section>

      {isText ? (
        <Section title="Text" note={textSpec ? `${textSpec.split} split` : 'not typeset'}>
          {textSpec ? (
            <TextPanel />
          ) : (
            <p className="num leading-snug">
              This template came from text, but the run that made it was not saved with it. Pick
              Text again to typeset a fresh one.
            </p>
          )}
        </Section>
      ) : null}

      <Section
        title="Regions"
        note={`${regions.length} in paint order`}
        subtitle="Drop an image straight onto a region to fill it."
      >
        {regions.length === 0 ? (
          <p className="num leading-snug">
            This template has no regions, so there is nothing to fill.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {regions.map((region) => (
              <RegionCard key={region.id} region={region} fill={fills[region.id]} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Composition">
        <Controls />
      </Section>

      <Section title="Output">
        <Toolbar />
      </Section>
    </aside>
  );
}

function Section({
  title,
  note,
  subtitle,
  children,
}: {
  title: string;
  note?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-line px-5 py-7 last:border-b-0">
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
