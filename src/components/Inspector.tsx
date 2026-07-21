import { useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { currentTemplate, useStore } from '../store';
import { CUSTOM_TEMPLATE_ID, TEMPLATES, sortedRegions } from '../templates';
import { parseSvgToTemplate } from '../lib/svgImport';
import { Controls } from './Controls';
import { RegionCard } from './RegionCard';
import { Toolbar } from './Toolbar';

export function Inspector() {
  const template = useStore(currentTemplate);
  const templateId = useStore((s) => s.composition.templateId);
  const fills = useStore((s) => s.composition.fills);
  const customTemplate = useStore((s) => s.customTemplate);
  const setTemplate = useStore((s) => s.setTemplate);
  const setCustomTemplate = useStore((s) => s.setCustomTemplate);
  const toast = useStore((s) => s.toast);

  const svgRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  const regions = sortedRegions(template);

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

  return (
    <aside
      aria-label="Inspector"
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
              active={templateId === CUSTOM_TEMPLATE_ID}
              onClick={() => setTemplate(CUSTOM_TEMPLATE_ID)}
            />
          ) : null}

          <button
            type="button"
            className="btn col-span-2 w-full"
            disabled={reading}
            onClick={() => svgRef.current?.click()}
          >
            {reading ? 'Reading…' : customTemplate ? 'Replace custom SVG' : 'Custom SVG'}
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
