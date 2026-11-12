import fastStringTruncatedWidth from 'fast-string-truncated-width';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { editorConfigWidth } from './editorconfig.js';

const DEFAULT_WIDTH = 80;

const widthOptions = {
  tabWidth: 1,
  emojiWidth: 2,
  regularWidth: 1,
  wideWidth: 2
};

/**
 * Display width of a string, counting wide CJK characters and emoji as 2.
 *
 * @param {string} value
 * @returns {number}
 */
function displayWidth(value) {
  return fastStringTruncatedWidth(value, { limit: Infinity }, widthOptions)
    .width;
}

// ASCII soft-wrap whitespace (space, tab, newline, form feed, vertical tab).
// Unicode spaces (no-break U+00A0, narrow no-break U+202F, …) are intentional
// content and are left untouched, so they survive reflow.
const SOFT_WHITESPACE = /[ \t\n\r\f\v]+/g;

function* proseWords(text, parseOptions) {
  const codeSpans = [];
  function visit(node) {
    if (node.type === 'inlineCode') codeSpans.push(node.position);
    else if (node.children) node.children.forEach(visit);
  }
  if (text.includes('`')) visit(fromMarkdown(text, parseOptions));

  let span = 0;
  let start = 0;
  for (const match of text.matchAll(SOFT_WHITESPACE)) {
    while (span < codeSpans.length && codeSpans[span].end.offset <= match.index) span++;
    if (span < codeSpans.length && codeSpans[span].start.offset <= match.index) continue;
    yield text.slice(start, match.index);
    start = match.index + match[0].length;
  }
  yield text.slice(start);
}

/**
 * Greedily wrap words to a maximum display width, collapsing only ASCII soft-wrap whitespace outside inline code. Words and code spans wider than the limit are kept intact.
 *
 * @param {string} text
 * @param {number} width
 * @param {import('mdast-util-from-markdown').Options} parseOptions
 * @returns {string}
 */
function fill(text, width, parseOptions) {
  /** @type {Array<string>} */
  const lines = [];
  let line = '';
  let lineWidth = 0;

  for (const word of proseWords(text, parseOptions)) {
    if (!word) continue;
    const wordWidth = displayWidth(word);
    if (line === '') {
      line = word;
      lineWidth = wordWidth;
    } else if (lineWidth + 1 + wordWidth <= width) {
      line += ' ' + word;
      lineWidth += 1 + wordWidth;
    } else {
      lines.push(line);
      line = word;
      lineWidth = wordWidth;
    }
  }

  if (line) lines.push(line);
  return lines.join('\n');
}

/**
 * Serialize a paragraph like the default `mdast-util-to-markdown` handler.
 *
 * @type {import('mdast-util-to-markdown').Handle}
 */
function serializeParagraph(node, _parent, state, info) {
  const exit = state.enter('paragraph');
  const subexit = state.enter('phrasing');
  const value = state.containerPhrasing(node, info);
  subexit();
  exit();
  return value;
}

/**
 * Find the `paragraph` handler `mdast-util-to-markdown` resolves from these
 * extensions: nested extensions apply first and later handlers win.
 *
 * @param {Array<import('mdast-util-to-markdown').Options> | undefined} extensions
 * @returns {import('mdast-util-to-markdown').Handle | undefined}
 */
function findParagraphHandler(extensions = []) {
  let handler;
  for (const extension of extensions) {
    handler = findParagraphHandler(extension.extensions) ?? handler;
    handler = extension.handlers?.paragraph ?? handler;
  }
  return handler;
}

/**
 * Wrap prose to a maximum line width when serializing back to markdown.
 *
 * Only paragraphs are reflowed. Indentation from lists and block quotes is
 * handled by the default serializer, so wrapping stays correct (and within
 * width) at every nesting level. A leading GitHub alert marker (`[!NOTE]`,
 * serialized from a `gfmAlert` node) is kept on its own line.
 *
 * The output of a `paragraph` handler registered by an earlier plugin, such as
 * the task list checkbox from `remark-gfm`, is wrapped too. Use this plugin
 * after such plugins, as a later `paragraph` handler replaces this one.
 *
 * Width is resolved in order: the `width` option, then `.editorconfig`'s
 * `max_line_length`, then `80`.
 *
 * @this {import('unified').Processor}
 * @param {object} [options]
 * @param {number} [options.width]
 *   Maximum display width (columns) per line. Overrides `.editorconfig`.
 *   Defaults to `max_line_length` from `.editorconfig`, otherwise `80`.
 */
export default function remarkWrapProse(options = {}) {
  const width = options.width ?? editorConfigWidth() ?? DEFAULT_WIDTH;

  const data = this.data();
  data.toMarkdownExtensions = data.toMarkdownExtensions || [];
  const serialize = findParagraphHandler(data.toMarkdownExtensions) ?? serializeParagraph;
  data.toMarkdownExtensions.push({
    handlers: {
      paragraph(node, parent, state, info) {
        const value = serialize.call(this, node, parent, state, info);

        const available = Math.max(1, width - (info.lineShift || 0));
        const parseOptions = {
          extensions: data.micromarkExtensions,
          mdastExtensions: data.fromMarkdownExtensions
        };

        const first = node.children[0];
        if (first?.type === 'gfmAlert') {
          const marker = value.slice(0, first.value.length);
          const body = fill(value.slice(first.value.length), available, parseOptions);
          return body ? marker + '\n' + body : marker;
        }

        return fill(value, available, parseOptions);
      }
    }
  });
}
