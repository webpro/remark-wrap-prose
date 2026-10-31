# remark-wrap-prose

Wrap prose to a maximum line width when serializing markdown.

Only paragraphs are reflowed. Indentation from lists and block quotes is handled
by the default serializer, so wrapping stays within the limit at every nesting
level. Tables, code, and other non-prose blocks are left untouched. Wide CJK
characters and emoji count as two columns. Words wider than the limit are never
broken mid-word.

Inline code stays intact and retains its whitespace, even when a code span exceeds the limit.

## Install

```sh
pnpm add @webpro/remark-wrap-prose
```

## Use

```js
import { remark } from "remark";
import remarkWrapProse from "@webpro/remark-wrap-prose";

const file = await remark().use(remarkWrapProse, { width: 80 }).process(input);
```

## Example

### Input

```markdown
Custom elements are registered under a tag name. When such a class isn't referenced elsewhere, it would be reported as unused. Instead, the registration is recognized.

- A list item with enough words in it to require wrapping across more than one single line at the configured width.
```

### Output

```markdown
Custom elements are registered under a tag name. When such a class isn't
referenced elsewhere, it would be reported as unused. Instead, the registration
is recognized.

- A list item with enough words in it to require wrapping across more than one
  single line at the configured width.
```

## Width

The wrap width is resolved in order:

1. The `width` option.
2. `max_line_length` from the nearest [`.editorconfig`][editorconfig].
3. `80`.

Prettier maps `max_line_length` to `printWidth`, so a single `.editorconfig`
entry drives both this plugin's prose wrapping and Prettier's code/table
wrapping.

[editorconfig]: https://editorconfig.org
