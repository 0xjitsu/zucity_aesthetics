import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { currentTemplate, useStore } from '../store';
import { copyPngToClipboard, exportPng } from '../lib/pngExport';
import { exportSvg } from '../lib/svgExport';
import { exportJson, importJson } from '../lib/fileIo';

type Job = 'png' | 'svg' | 'copy' | 'json' | 'import';

const JOB_LABEL: Record<Job, string> = {
  png: 'Export PNG',
  svg: 'Export SVG',
  copy: 'Copy PNG',
  json: 'Export JSON',
  import: 'Import JSON',
};

export function Toolbar() {
  const assetCount = useStore((s) => Object.keys(s.assets).length);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const loadFile = useStore((s) => s.loadFile);
  const resetAll = useStore((s) => s.resetAll);
  const randomize = useStore((s) => s.randomize);
  const toast = useStore((s) => s.toast);

  const importRef = useRef<HTMLInputElement>(null);
  const [job, setJob] = useState<Job | null>(null);

  async function run(next: Job, fn: () => void | Promise<void>) {
    if (job) return;
    setJob(next);
    try {
      await fn();
    } catch (err) {
      toast(
        'error',
        `${JOB_LABEL[next]} failed`,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setJob(null);
    }
  }

  // Read at click time, not via subscriptions: these change on every drag frame
  // and the render output never shows them.
  const input = () => {
    const s = useStore.getState();
    return { template: currentTemplate(s), composition: s.composition, assets: s.assets };
  };

  function onImportPicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void run('import', async () => {
      const doc = await importJson(file);
      loadFile(doc);
      toast('ok', 'look restored \\(^o^)/', file.name);
    });
  }

  const label = (j: Job, idle: string) => (job === j ? 'Working…' : idle);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className="btn btn-accent w-full"
        disabled={job !== null}
        onClick={() =>
          void run('png', async () => {
            await exportPng(input());
            toast(
              'ok',
              'png saved \\(^o^)/',
              `${useStore.getState().composition.exportSize} px, straight to your downloads`,
            );
          })
        }
      >
        {label('png', 'Export PNG')}
      </button>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="btn w-full"
          disabled={job !== null}
          onClick={() =>
            void run('svg', () => {
              exportSvg(input());
              toast('ok', 'svg saved \\(^o^)/', 'every region stays editable in illustrator or figma');
            })
          }
        >
          {label('svg', 'Export SVG')}
        </button>

        <button
          type="button"
          className="btn w-full"
          disabled={job !== null}
          onClick={() =>
            void run('copy', async () => {
              await copyPngToClipboard(input());
              toast('ok', 'copied!', 'the image is on your clipboard — paste it anywhere');
            })
          }
        >
          {label('copy', 'Copy PNG')}
        </button>

        <button
          type="button"
          className="btn w-full"
          disabled={job !== null}
          onClick={() =>
            void run('json', () => {
              const { customTemplate, textSpec, fonts } = useStore.getState();
              const doc = input();
              exportJson({ ...doc, customTemplate, textSpec, fonts });
              // Mirrors exportJson: only textures a fill points at are packed.
              const used = new Set<string>();
              for (const fill of Object.values(doc.composition.fills)) {
                if (fill.kind === 'image' && fill.assetId && doc.assets[fill.assetId]) {
                  used.add(fill.assetId);
                }
              }
              toast(
                'ok',
                'look saved \\(^o^)/',
                `${used.size} texture${used.size === 1 ? '' : 's'} packed inside`,
              );
            })
          }
        >
          {label('json', 'Export JSON')}
        </button>

        <button
          type="button"
          className="btn w-full"
          disabled={job !== null}
          onClick={() => importRef.current?.click()}
        >
          {label('import', 'Import JSON')}
        </button>
      </div>

      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        tabIndex={-1}
        aria-label="Import a MaskLab JSON file"
        onChange={onImportPicked}
      />

      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line-soft pt-3">
        <button
          type="button"
          className="btn w-full"
          aria-label="Undo the last edit"
          disabled={!canUndo}
          onClick={() => undo()}
        >
          Undo
        </button>
        <button
          type="button"
          className="btn w-full"
          aria-label="Redo the last undone edit"
          disabled={!canRedo}
          onClick={() => redo()}
        >
          Redo
        </button>
        <button
          type="button"
          className="btn w-full"
          disabled={job !== null}
          onClick={() => randomize()}
        >
          Remix
        </button>
        <button
          type="button"
          className="btn w-full"
          disabled={job !== null}
          onClick={() => resetAll()}
        >
          Reset
        </button>
      </div>

      <p className="num mt-2 leading-snug">
        {assetCount === 0
          ? 'No images loaded yet. Remix will shuffle colours only.'
          : `${assetCount} image${assetCount === 1 ? '' : 's'} loaded and embedded on export.`}
      </p>

      <p className="num hidden leading-snug lg:block">
        1–9 select · [ ] cycle · arrows nudge · R reset region · ⌘Z undo · ⇧⌘Z redo
      </p>
    </div>
  );
}
