import { useEffect, useRef, useState } from 'react';
import { currentTemplate, useStore } from '../store';

/**
 * A small kaomoji companion in the stage footer. It reacts to what the user
 * is actually doing — selection, texture count, errors — so it reads as a
 * buddy rather than a mascot. One buddy, whole app; whimsy is a garnish.
 */

/** Static per device; a phone does not grow a mouse mid-session. */
const COARSE =
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
const GESTURES = COARSE
  ? 'drag to pan · pinch to zoom · twist to spin'
  : 'drag to pan · scroll to zoom · shift-scroll to spin';

const IDLE = '(・_・)';
const BLINK = '(-_-)';
const SELECTED = '(o_o)!';
const TEXTURED = '(≧▽≦)';
const ERROR = '(x_x)';

export function Buddy() {
  const selectedId = useStore((s) => s.selectedId);
  const hasError = useStore((s) => s.toasts.some((t) => t.tone === 'error'));
  const textured = useStore((s) =>
    Object.values(s.composition.fills).some((f) => f.kind === 'image'),
  );
  const template = useStore(currentTemplate);
  const selectedName = useStore((s) => {
    if (!s.selectedId) return null;
    const region = currentTemplate(s).regions.find((r) => r.id === s.selectedId);
    return region?.name ?? null;
  });

  const [blinking, setBlinking] = useState(false);
  const timer = useRef<number | null>(null);

  // An idle buddy blinks now and then. Interval, not rAF — it is cosmetic.
  useEffect(() => {
    const tick = () => {
      setBlinking(true);
      window.setTimeout(() => setBlinking(false), 160);
      timer.current = window.setTimeout(tick, 3200 + Math.random() * 2600);
    };
    timer.current = window.setTimeout(tick, 3000);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  let face = IDLE;
  let line = `this is ${template.name.toLowerCase()} — click a region to start`;
  let excited = false;

  if (hasError) {
    face = ERROR;
    line = 'something went sideways — check the toast';
  } else if (selectedId && selectedName) {
    face = SELECTED;
    line = `${selectedName.toLowerCase()} selected · ${GESTURES}`;
  } else if (textured) {
    face = TEXTURED;
    line = 'looking good — click a region to remix, or export it';
    excited = true;
  }

  if (blinking && face === IDLE) face = BLINK;

  return (
    <p className="buddy min-w-0 flex-1">
      <span aria-hidden="true" className={`buddy-face shrink-0 ${excited ? 'buddy-face-excited' : ''}`}>
        {face}
      </span>
      {/* One line on phones so the sticky stage never grows; desktop has room. */}
      <span className="min-w-0 truncate lg:whitespace-normal">{line}</span>
    </p>
  );
}
