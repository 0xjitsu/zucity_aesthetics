import { useStore } from '../store';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col gap-2 p-4 sm:inset-x-auto sm:right-0 sm:w-[380px] sm:max-w-full"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`panel pointer-events-auto flex items-start gap-2 border-l-2 ${
            t.tone === 'error' ? 'border-l-accent' : 'border-l-line'
          }`}
        >
          <div className="min-w-0 flex-1 py-3 pl-3">
            <p
              className={`truncate text-[12px] leading-tight ${
                t.tone === 'error' ? 'text-accent' : 'text-ink'
              }`}
            >
              {t.title}
            </p>
            {t.detail ? <p className="num mt-1 leading-snug break-words">{t.detail}</p> : null}
          </div>
          <button
            type="button"
            className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center text-faint transition-colors hover:text-ink"
            aria-label={`Dismiss notification: ${t.title}`}
            onClick={() => dismiss(t.id)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              aria-hidden="true"
            >
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
