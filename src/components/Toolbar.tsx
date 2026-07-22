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
  const template = useStore(currentTemplate);
  const composition = useStore((s) => s.composition);
  const assets = useStore((s) => s.assets);
  const customTemplate = useStore((s) => s.customTemplate);
  const textSpec = useStore((s) => s.textSpec);
  const fonts = useStore((s) => s.fonts);
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

  const input = () => ({ template, composition, assets });

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
            toast('ok', 'png saved \\(^o^)/', `${composition.exportSize} px, straight to your downloads`);
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
              exportJson({ ...input(), customTemplate, textSpec, fonts });
              toast('ok', 'look saved \\(^o^)/', `${Object.keys(assets).length} textures packed inside`);
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
        onChange={onImportPicked}
      />

      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line-soft pt-3">
        <button
          type="button"
          className="btn w-full"
          disabled={job !== null}
          onClick={() => randomize()}
        >
          Randomize
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
        {Object.keys(assets).length === 0
          ? 'No images loaded yet. Randomize will shuffle colours only.'
          : `${Object.keys(assets).length} image${
              Object.keys(assets).length === 1 ? '' : 's'
            } loaded and embedded on export.`}
      </p>
    </div>
  );
}
