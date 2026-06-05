import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Read `max_line_length` that applies to a markdown file in `dir`, from the
 * nearest `.editorconfig` files (walking up to a `root = true` file). A focused
 * reader: it only needs this one property and the glob features that occur in
 * practice (`*`, `**`, `?`, `[set]`, `{a,b}`). Prettier maps the same key to
 * `printWidth`, so one setting drives both prose and code wrapping.
 *
 * @param {string} [dir]
 * @returns {number | undefined}
 */
export function editorConfigWidth(dir = process.cwd()) {
  try {
    const configs = [];
    for (let current = dir; ; ) {
      let text;
      try {
        text = readFileSync(join(current, '.editorconfig'), 'utf8');
      } catch {}
      if (text !== undefined) {
        const config = parseEditorConfig(text);
        configs.push(config);
        if (config.root) break;
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }

    // Nearest config wins, so apply the farthest first and let nearer override.
    let value;
    for (const config of configs.reverse()) {
      for (const [pattern, max] of config.sections) {
        if (max !== undefined && pattern.test('x.md')) value = max;
      }
    }

    const width = Number(value);
    return Number.isInteger(width) && width > 0 ? width : undefined;
  } catch {
    return undefined;
  }
}

/**
 * @param {string} text
 * @returns {{ root: boolean, sections: Array<[RegExp, string | undefined]> }}
 */
function parseEditorConfig(text) {
  let root = false;
  /** @type {Array<[RegExp, Record<string, string>]>} */
  const sections = [];
  let props;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      props = {};
      sections.push([globToRegExp(line.slice(1, -1)), props]);
      continue;
    }

    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const val = line.slice(eq + 1).trim();
    if (props) props[key] = val;
    else if (key === 'root') root = val.toLowerCase() === 'true';
  }

  return {
    root,
    sections: sections.map(([re, p]) => [re, p.max_line_length])
  };
}

/**
 * Compile an EditorConfig section glob to an anchored RegExp.
 *
 * @param {string} glob
 * @returns {RegExp}
 */
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const close = glob.indexOf('}', i);
      if (close === -1) {
        re += '\\{';
      } else {
        const alts = glob.slice(i + 1, close).split(',');
        re += '(?:' + alts.map(a => globToRegExp(a).source.slice(1, -1)).join('|') + ')';
        i = close;
      }
    } else if (c === '[') {
      const close = glob.indexOf(']', i + 1);
      if (close === -1) {
        re += '\\[';
      } else {
        const set = glob.slice(i + 1, close);
        re += '[' + (set[0] === '!' ? '^' + set.slice(1) : set) + ']';
        i = close;
      }
    } else {
      re += c.replace(/[.+^${}()|\\]/g, '\\$&');
    }
  }
  return new RegExp('^' + re + '$');
}
