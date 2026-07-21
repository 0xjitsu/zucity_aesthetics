import { useEffect } from 'react';
import { currentTemplate, useStore } from '../store';
import { sortedRegions } from '../templates';

const NUDGE = 0.1;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  );
}

/**
 * Global shortcuts. Deliberately inert while a form control has focus, so
 * typing "9" into the export size box does not jump the selection.
 */
export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      const state = useStore.getState();
      const regions = sortedRegions(currentTemplate(state));
      const index = state.selectedId ? regions.findIndex((r) => r.id === state.selectedId) : -1;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        state.undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (/^[1-9]$/.test(e.key)) {
        const region = regions[Number(e.key) - 1];
        if (region) {
          e.preventDefault();
          state.select(region.id);
        }
        return;
      }

      if (e.key === '[' || e.key === ']') {
        if (!regions.length) return;
        e.preventDefault();
        const step = e.key === ']' ? 1 : -1;
        const next = (index + step + regions.length) % regions.length;
        state.select(regions[next].id);
        return;
      }

      if (!state.selectedId) return;
      const fill = state.composition.fills[state.selectedId];
      if (!fill) return;

      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        state.resetRegion(state.selectedId);
        return;
      }

      const step = e.shiftKey ? NUDGE * 5 : NUDGE;
      const nudges: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const delta = nudges[e.key];
      if (delta) {
        e.preventDefault();
        state.commitFill(state.selectedId, {
          offsetX: fill.offsetX + delta[0],
          offsetY: fill.offsetY + delta[1],
        });
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
