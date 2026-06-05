import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { remark } from 'remark';
import remarkDirective from 'remark-directive';
import remarkWrapProse from '../index.js';
import fstw from 'fast-string-truncated-width';

const wopt = { tabWidth: 1, emojiWidth: 2, regularWidth: 1, wideWidth: 2 };
const displayWidth = s => fstw(s, { limit: Infinity }, wopt).width;

function format(value, options) {
  return String(remark().use(remarkWrapProse, options).processSync(value));
}

const longLine =
  'This is a fairly long paragraph of plain prose that should definitely exceed eighty columns so that we can observe exactly where the wrapping boundary falls.';

test('wraps a long paragraph to the default width of 80', () => {
  const out = format(longLine + '\n');
  for (const line of out.trimEnd().split('\n')) {
    assert.ok(displayWidth(line) <= 80, `line too wide: ${line}`);
  }
  assert.ok(out.trimEnd().includes('\n'), 'expected the paragraph to wrap');
});

test('falls back to .editorconfig max_line_length when no width option', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wrap-prose-'));
  writeFileSync(join(dir, '.editorconfig'), 'root = true\n\n[*]\nmax_line_length = 40\n');
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    const out = format(longLine + '\n'); // no width option
    for (const line of out.trimEnd().split('\n')) {
      assert.ok(displayWidth(line) <= 40, `line too wide: ${line}`);
    }
    assert.ok(out.trimEnd().split('\n').length > 2, 'wrapped at 40, not 80');
  } finally {
    process.chdir(cwd);
  }
});

test('reads .editorconfig with a scoped, brace-glob section and root walking', () => {
  const root = mkdtempSync(join(tmpdir(), 'wrap-prose-'));
  writeFileSync(join(root, '.editorconfig'), 'root = true\n\n[*.{md,mdx}]\nmax_line_length = 50\n');
  // A nested .editorconfig with a non-matching section must not interfere.
  const nested = join(root, 'docs');
  mkdirSync(nested);
  writeFileSync(join(nested, '.editorconfig'), '[*.ts]\nmax_line_length = 30\n');
  const cwd = process.cwd();
  try {
    process.chdir(nested);
    const out = format(longLine + '\n'); // no width option
    for (const line of out.trimEnd().split('\n')) {
      assert.ok(displayWidth(line) <= 50, `line too wide: ${line}`);
    }
    assert.ok(out.trimEnd().split('\n').length > 2, 'wrapped at 50 from [*.{md,mdx}]');
  } finally {
    process.chdir(cwd);
  }
});

test('width option overrides .editorconfig', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wrap-prose-'));
  writeFileSync(join(dir, '.editorconfig'), 'root = true\n\n[*]\nmax_line_length = 40\n');
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    const out = format(longLine + '\n', { width: 70 });
    const widths = out.trimEnd().split('\n').map(displayWidth);
    for (const w of widths) assert.ok(w <= 70);
    assert.ok(Math.max(...widths) > 40, 'option (70) wins over .editorconfig (40)');
  } finally {
    process.chdir(cwd);
  }
});

test('respects the width option', () => {
  const out = format(longLine + '\n', { width: 40 });
  for (const line of out.trimEnd().split('\n')) {
    assert.ok(displayWidth(line) <= 40, `line too wide: ${line}`);
  }
});

test('does not wrap content that already fits', () => {
  assert.equal(format('Short line.\n'), 'Short line.\n');
});

test('never breaks a single word wider than the limit', () => {
  const url = 'https://example.com/' + 'a'.repeat(120);
  const out = format(`See ${url} here.\n`, { width: 40 });
  assert.ok(out.includes(url), 'the long token should stay intact');
});

test('indents wrapped list-item continuation lines within width', () => {
  const out = format(
    '- A list item with enough words in it to require wrapping across more than one single line at the configured width of eighty.\n'
  );
  const lines = out.trimEnd().split('\n');
  assert.ok(lines.length > 1, 'expected the item to wrap');
  assert.match(lines[0], /^[-*] /);
  for (const line of lines.slice(1)) assert.match(line, /^ {2}\S/);
  for (const line of lines) assert.ok(displayWidth(line) <= 80);
});

test('indents nested list items within width', () => {
  const out = format(
    [
      '- Outer item that is short.',
      '  - A nested item that also has quite a lot of words so that it needs to wrap and we can check the continuation indentation lines up under the nested marker.'
    ].join('\n') + '\n'
  );
  for (const line of out.trimEnd().split('\n')) {
    assert.ok(displayWidth(line) <= 80, `line too wide: ${line}`);
  }
  assert.match(out, /\n {4}\S/, 'nested continuation indented by four spaces');
});

test('keeps block-quote markers on wrapped lines within width', () => {
  const out = format('> ' + longLine + '\n');
  for (const line of out.trimEnd().split('\n')) {
    assert.match(line, /^> /);
    assert.ok(displayWidth(line) <= 80, `line too wide: ${line}`);
  }
});

test('wraps by display width for wide characters', () => {
  // Space-separated wide words: each "東京" is 4 columns but 2 code units, so a
  // char-length wrapper would overshoot a 40-column limit.
  const cjk = '東京 '.repeat(40).trim() + '\n';
  const out = format(cjk, { width: 40 });
  const lines = out.trimEnd().split('\n');
  assert.ok(lines.length > 1, 'expected the wide text to wrap');
  for (const line of lines) {
    assert.ok(displayWidth(line) <= 40, `display width over 40: ${line}`);
  }
});

test('preserves escapes that depend on phrasing context (directive colon)', () => {
  // remark-directive only escapes `:` while the `phrasing` construct is active,
  // so the paragraph handler must enter it. Otherwise `path\:knip.json` would
  // re-serialize as `path:knip.json` and re-parse as a `:knip` text directive.
  const value =
    'See the path\\:knip.json reference plus enough extra words here to force the line to wrap.\n';
  const out = String(
    remark()
      .use(remarkDirective)
      .use(remarkWrapProse, { width: 40 })
      .processSync(value)
  );
  assert.ok(out.includes('path\\:knip.json'), `escaped colon dropped:\n${out}`);
});

test('preserves non-breaking and other Unicode spaces (collapses only ASCII)', () => {
  // ❌ + space + U+202F narrow no-break space + space + text.
  const value =
    '❌   Don’t use ignore for generated artifacts and a few more words to wrap.\n';
  const out = format(value, { width: 50 });
  assert.ok(out.includes(' '), 'narrow no-break space must survive');
  // Multiple ASCII spaces still collapse to one.
  assert.ok(!/❌ {2,}/.test(out), 'ASCII runs collapse');
  for (const line of out.trimEnd().split('\n')) {
    assert.ok(displayWidth(line) <= 50, `line too wide: ${line}`);
  }
});

test('is idempotent', () => {
  const once = format(longLine + '\n');
  assert.equal(format(once), once);
});

// Mirror how a preset extracts a leading GitHub alert marker into its own node.
function injectAlert() {
  this.data().toMarkdownExtensions ??= [];
  this.data().toMarkdownExtensions.push({
    handlers: { gfmAlert: node => node.value }
  });
  return tree => {
    const text = tree.children[0]?.children?.[0];
    if (text?.type === 'text') {
      const match = text.value.match(/^\[![A-Z]+\]/);
      if (match) {
        const rest = text.value.slice(match[0].length);
        tree.children[0].children.splice(
          0,
          1,
          { type: 'gfmAlert', value: match[0] },
          { type: 'text', value: rest }
        );
      }
    }
  };
}

test('keeps a leading GitHub alert marker on its own line', () => {
  const value =
    '[!NOTE]\nThis is a GitHub alert with a reasonably long sentence inside of it so that it must wrap across more than a single line at the configured width.\n';
  const out = String(
    remark()
      .use(injectAlert)
      .use(remarkWrapProse)
      .processSync(value)
  );
  const lines = out.trimEnd().split('\n');
  assert.equal(lines[0], '[!NOTE]', 'marker stays alone on the first line');
  assert.ok(lines.length > 2, 'body wraps onto multiple lines');
  for (const line of lines) assert.ok(displayWidth(line) <= 80);
});
