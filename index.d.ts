export interface Options {
  /**
   * Maximum display width (columns) per line. Overrides `.editorconfig`.
   *
   * Resolved in order: this option, then `max_line_length` from
   * `.editorconfig`, then `80`.
   */
  width?: number;
}

/**
 * Wrap prose to a maximum line width when serializing back to markdown.
 */
export default function remarkWrapProse(options?: Options): undefined;
