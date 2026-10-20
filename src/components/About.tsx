// Same words as the crawlable fallback inside <div id="root"> in index.html.
// Keep the two in step: what crawlers read must be what users see.

const LINKS = [
  { href: 'https://zucity.org', label: 'zucity.org' },
  { href: 'https://x.com/zucity_japan', label: 'X' },
  { href: 'https://instagram.com/zucity_japan', label: 'Instagram' },
  { href: 'https://jpy2.substack.com', label: 'Substack' },
];

const link = 'text-accent underline underline-offset-2';

export function About() {
  return (
    <section aria-labelledby="about-heading" className="space-y-2 text-xs leading-relaxed text-muted">
      <h2 id="about-heading" className="label">
        About
      </h2>
      <p>
        MaskLab is a free browser tool that fills each region of a vector shape — a yin-yang by
        default — or each letter of typed text, including vertical Japanese, with its own texture. Use
        it for flags, stickers and album covers.
      </p>
      <p>
        Made for{' '}
        <a href="https://zucity.org" target="_blank" rel="noopener noreferrer" className={link}>
          ZuCity
        </a>
        , a coliving neighborhood an hour from Tokyo in the Japanese Alps. Everything runs in your
        browser; nothing is uploaded.
      </p>
      <ul className="list-disc space-y-0.5 pl-4">
        <li>Texture fill per region, with zoom, rotate and blend</li>
        <li>Built-in shapes, your own SVG, or typed text</li>
        <li>Export PNG, SVG or a JSON save file</li>
      </ul>
      <p>
        Questions?{' '}
        <a href="/guide.html" className={link}>
          Read the guide
        </a>
      </p>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {LINKS.map((l) => (
          <li key={l.href}>
            <a href={l.href} target="_blank" rel="noopener noreferrer" className={link}>
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
