import fastStringTruncatedWidth from 'fast-string-truncated-width';
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
const SOFT_WHITESPACE = /[ \t\n\r\f\v]+/;

/**
 * Greedily wrap words to a maximum display width, collapsing only ASCII
 * soft-wrap whitespace. Words wider than the limit are kept intact (never
 * broken mid-word).
 *
 * @param {string} text
 * @param {number} width
 * @returns {string}
 */
function fill(text, width) {
  /** @type {Array<string>} */
  const lines = [];
  let line = '';
  let lineWidth = 0;

  for (const word of text.split(SOFT_WHITESPACE)) {
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
 * Wrap prose to a maximum line width when serializing back to markdown.
 *
 * Only paragraphs are reflowed. Indentation from lists and block quotes is
 * handled by the default serializer, so wrapping stays correct (and within
 * width) at every nesting level. A leading GitHub alert marker (`[!NOTE]`,
 * serialized from a `gfmAlert` node) is kept on its own line.
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
  data.toMarkdownExtensions.push({
    handlers: {
      paragraph(node, _parent, state, info) {
        const exit = state.enter('paragraph');
        const subexit = state.enter('phrasing');
        const value = state.containerPhrasing(node, info);
        subexit();
        exit();

        const available = Math.max(1, width - (info.lineShift || 0));

        const first = node.children[0];
        if (first?.type === 'gfmAlert') {
          const marker = value.slice(0, first.value.length);
          const body = fill(value.slice(first.value.length), available);
          return body ? marker + '\n' + body : marker;
        }

        return fill(value, available);
      }
    }
  });
}
