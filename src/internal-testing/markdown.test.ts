/**
 * Minimal-Markdown renderer tests.
 *
 * Proves the supported subset renders, and — just as important — that anything
 * outside the subset degrades to escaped prose rather than injecting raw HTML.
 */

import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown.js';

describe('renderMarkdown — block level', () => {
  it('renders ATX headings levels 1–3', () => {
    const html = renderMarkdown('# H1\n\n## H2\n\n### H3');
    expect(html).toContain('<h1>H1</h1>');
    expect(html).toContain('<h2>H2</h2>');
    expect(html).toContain('<h3>H3</h3>');
  });

  it('joins blank-line-separated paragraphs and wraps each in <p>', () => {
    const html = renderMarkdown('Line one\ncontinued.\n\nSecond paragraph.');
    expect(html).toContain('<p>Line one continued.</p>');
    expect(html).toContain('<p>Second paragraph.</p>');
  });

  it('collapses consecutive `- ` items into a single <ul>', () => {
    const html = renderMarkdown('- first\n- second\n- third');
    const ulCount = (html.match(/<ul>/g) ?? []).length;
    expect(ulCount).toBe(1);
    expect(html).toContain('<li>first</li>');
    expect(html).toContain('<li>second</li>');
    expect(html).toContain('<li>third</li>');
  });

  it('ends a list when prose follows, then starts a new paragraph', () => {
    const html = renderMarkdown('- only item\nback to prose');
    expect(html).toContain('<li>only item</li>');
    expect(html).toContain('</ul>');
    expect(html).toContain('<p>back to prose</p>');
    // The prose must NOT be swallowed into the <li>.
    expect(html).not.toContain('<li>back to prose</li>');
  });

  it('returns empty string for empty / whitespace-only input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('\n\n   \n')).toBe('');
  });
});

describe('renderMarkdown — inline + safety', () => {
  it('renders `code` and **bold**', () => {
    const html = renderMarkdown('Use `crap` and **never** skip.');
    expect(html).toContain('<code>crap</code>');
    expect(html).toContain('<strong>never</strong>');
  });

  it('HTML-escapes authored angle brackets (no raw HTML injection)', () => {
    const html = renderMarkdown('A <script>alert(1)</script> tag and a & ampersand.');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&amp;');
  });

  it('escapes inside headings and list items too', () => {
    const html = renderMarkdown('# <b>title</b>\n\n- <i>item</i>');
    expect(html).toContain('<h1>&lt;b&gt;title&lt;/b&gt;</h1>');
    expect(html).toContain('<li>&lt;i&gt;item&lt;/i&gt;</li>');
  });

  it('does not bold ** that lives inside a code span', () => {
    const html = renderMarkdown('`a ** b`');
    expect(html).toContain('<code>a ** b</code>');
    expect(html).not.toContain('<strong>');
  });
});
