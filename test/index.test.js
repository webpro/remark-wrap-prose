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

test('moves inline code intact to the next line at 80 columns', () => {
  assert.equal(
    format('The array of possible values for this particular configuration option is `[true, false]`.\n', { width: 80 }),
    'The array of possible values for this particular configuration option is\n`[true, false]`.\n'
  );
});

for (const { name, input, width, expected } of [
  {
    name: 'keeps inline code on the current line when it fits exactly',
    input: 'Use `[true, false]` now.\n',
    width: 24,
    expected: 'Use `[true, false]` now.\n'
  },
  {
    name: 'keeps inline code wider than the limit intact',
    input: 'Use `[true, false]` now.\n',
    width: 10,
    expected: 'Use\n`[true, false]`\nnow.\n'
  },
  {
    name: 'keeps punctuation attached to inline code',
    input: 'Use (`[true, false]`) now.\n',
    width: 20,
    expected: 'Use\n(`[true, false]`)\nnow.\n'
  },
  {
    name: 'keeps inline code intact inside strong emphasis',
    input: '**Use `[true, false]` here** please.\n',
    width: 20,
    expected: '**Use\n`[true, false]`\nhere** please.\n'
  },
  {
    name: 'keeps inline code intact inside links',
    input: 'Choose [`[true, false]`](/values) now.\n',
    width: 24,
    expected: 'Choose\n[`[true, false]`](/values)\nnow.\n'
  },
  {
    name: 'wraps prose between multiple inline code spans',
    input: 'Use `a b` and `c d` today.\n',
    width: 12,
    expected: 'Use `a b`\nand `c d`\ntoday.\n'
  },
  {
    name: 'preserves inline code whitespace while collapsing prose spaces',
    input: 'Use   `a  b\tc`   here.\n',
    width: 40,
    expected: 'Use `a  b\tc` here.\n'
  },
  {
    name: 'preserves spaces in whitespace-only inline code',
    input: 'Use `   ` here.\n',
    width: 10,
    expected: 'Use `   `\nhere.\n'
  },
  {
    name: 'preserves inline code padding and embedded backticks',
    input: 'Use `` `a  b` `` here.\n',
    width: 12,
    expected: 'Use\n`` `a  b` ``\nhere.\n'
  },
  {
    name: 'keeps inline code intact in block quotes',
    input: '> Use `[true, false]` now.\n',
    width: 22,
    expected: '> Use `[true, false]`\n> now.\n'
  },
  {
    name: 'keeps inline code intact in list items',
    input: '* Use `[true, false]` now.\n',
    width: 18,
    expected: '* Use\n  `[true, false]`\n  now.\n'
  },
  {
    name: 'measures the display width of inline code',
    input: 'Use `東京 大阪` now.\n',
    width: 14,
    expected: 'Use\n`東京 大阪`\nnow.\n'
  },
  {
    name: 'wraps escaped backticks as prose around inline code',
    input: 'Use \\`a b\\` and `c d` now.\n',
    width: 8,
    expected: 'Use \\`a\nb\\` and\n`c d`\nnow.\n'
  },
  {
    name: 'distinguishes inline code from matching text in a link title',
    input: 'See [x](/u "`a b`") and `a b` now.\n',
    width: 6,
    expected: 'See\n[x](/u\n"`a\nb`")\nand\n`a b`\nnow.\n'
  },
  {
    name: 'distinguishes inline code from matching text in HTML attributes',
    input: 'Use <span title="`a b`">text</span> then `a b` done.\n',
    width: 9,
    expected: 'Use <span\ntitle="`a\nb`">text</span>\nthen\n`a b`\ndone.\n'
  },
  {
    name: 'keeps inline code intact when emphasis requires character references',
    input: 'See &#x61;*`a b`*&#x62; now.\n',
    width: 20,
    expected: 'See\n&#x61;*`a b`*&#x62;\nnow.\n'
  },
  {
    name: 'keeps inline code handling local to its paragraph',
    input: 'Use `a  b` now.\n\nPlain   prose here.\n',
    width: 12,
    expected: 'Use `a  b`\nnow.\n\nPlain prose\nhere.\n'
  }
]) {
  test(name, () => {
    const output = format(input, { width });
    assert.equal(output, expected);
    assert.equal(format(output, { width }), expected);
  });
}

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

test('uses directive syntax to distinguish inline code from attribute text', () => {
  const processor = remark().use(remarkDirective).use(remarkWrapProse, { width: 12 });
  const output = String(processor.processSync('Use :kbd[`a b`]{title="`c d`"} then `e f` now.\n'));
  const expected = 'Use\n:kbd[`a b`]{title="`c\nd`"} then\n`e f` now.\n';
  assert.equal(output, expected);
  assert.equal(String(processor.processSync(output)), expected);
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

test('keeps inline code intact after a GitHub alert marker', () => {
  const processor = remark().use(injectAlert).use(remarkWrapProse, { width: 10 });
  const output = String(processor.processSync('[!NOTE]\nUse `[true, false]` now.\n'));
  const expected = '[!NOTE]\nUse\n`[true, false]`\nnow.\n';
  assert.equal(output, expected);
  assert.equal(String(processor.processSync(output)), expected);
});
