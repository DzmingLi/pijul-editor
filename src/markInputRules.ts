// Inline-mark input rules for the markdown editor. Same idea as
// linkInputRule: detect the closing delimiter of a markdown inline
// syntax and replace the matched span with the bare text carrying a
// mark — so the WYSIWYG doc keeps ProseMirror marks instead of
// round-tripping through literal `**foo**` that the serializer would
// later escape.
//
// Fires on:
//   **x**     → strong
//   *x*       → em   (not inside ** pairs)
//   _x_       → em   (not inside snake_case identifiers)
//   `x`       → code
//   ~~x~~     → strikethrough (GFM; only if the schema has the mark)

import { InputRule } from 'prosemirror-inputrules';
import type { Schema } from 'prosemirror-model';

function makeMarkRule(
  schema: Schema,
  markName: string,
  regex: RegExp,
): InputRule | null {
  const markType = schema.marks[markName];
  if (!markType) return null;
  return new InputRule(regex, (state, match, start, end) => {
    const text = match[1];
    if (!text) return null;
    const node = schema.text(text, [markType.create()]);
    return state.tr.replaceWith(start, end, node);
  });
}

/** `**text**` → strong. Content may not contain `*` or newlines. */
export function strongInputRule(schema: Schema): InputRule | null {
  return makeMarkRule(schema, 'strong', /\*\*([^*\n]+)\*\*$/);
}

/** `*text*` → em. Negative lookbehind prevents firing inside `**bold**`
 *  (the opening `*` would be the second char of `**`). */
export function emAsteriskInputRule(schema: Schema): InputRule | null {
  return makeMarkRule(schema, 'em', /(?<!\*)\*([^*\n]+)\*$/);
}

/** `_text_` → em. Lookbehind rejects word chars / underscores before
 *  the opening `_`, so `snake_case_var` doesn't italicize `case`. */
export function emUnderscoreInputRule(schema: Schema): InputRule | null {
  return makeMarkRule(schema, 'em', /(?<![\w_])_([^_\n]+)_$/);
}

/** `` `text` `` → inline code. */
export function codeInputRule(schema: Schema): InputRule | null {
  return makeMarkRule(schema, 'code', /`([^`\n]+)`$/);
}

/** `~~text~~` → strikethrough. Null if schema has no `strikethrough` mark. */
export function strikethroughInputRule(schema: Schema): InputRule | null {
  return makeMarkRule(schema, 'strikethrough', /~~([^~\n]+)~~$/);
}

/** All inline-mark rules supported by the basic markdown schema. */
export function markInputRules(schema: Schema): InputRule[] {
  return [
    strongInputRule(schema),
    emAsteriskInputRule(schema),
    emUnderscoreInputRule(schema),
    codeInputRule(schema),
    strikethroughInputRule(schema),
  ].filter((r): r is InputRule => r !== null);
}
