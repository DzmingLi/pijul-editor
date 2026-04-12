/**
 * Shared math rendering, NodeViews, and ProseMirror plugins.
 *
 * Used by both MarkdownEditor and TypstEditor to provide inline ($…$) and
 * block ($$…$$) math editing with server-side rendering to MathML.
 */

import { Plugin, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PNode } from 'prosemirror-model';
import type { Schema } from 'prosemirror-model';
import type { NodeView, EditorView } from 'prosemirror-view';

// ── Math rendering cache ─────────────────────────────────────────────────────
const mathCache = new Map<string, string>();

// Typst wraps all output in <p>…</p>. Strip it so we can safely set
// innerHTML on either a <span> (inline) or <div> (block) without invalid
// nesting — a <p> inside a <span> causes the browser to eject the <span>
// content entirely, making the rendered element appear empty.
function stripPWrapper(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const first = tmp.firstElementChild;
  if (first && first.tagName === 'P') return first.innerHTML;
  return html;
}

export async function fetchMathHtml(
  formula: string,
  display: boolean,
  renderEndpoint: string,
): Promise<string> {
  const key = `${display ? 'B' : 'I'}:${formula}`;
  if (mathCache.has(key)) return mathCache.get(key)!;
  try {
    const res = await fetch(renderEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formula, display }),
    });
    if (res.ok) {
      const { html } = await res.json();
      const stripped = stripPWrapper(html);
      mathCache.set(key, stripped);
      return stripped;
    }
    console.warn('[math] render API returned', res.status, 'for formula:', formula);
  } catch (err) {
    console.warn('[math] render API fetch failed:', err);
  }
  return display
    ? `<span class="math-fallback">$ ${formula} $</span>`
    : `<span class="math-fallback">$${formula}$</span>`;
}

// ── MathInlineNodeView ───────────────────────────────────────────────────────
// Atom node view for math_inline. Formula stored in node.attrs.formula.
// Editing via a floating <input> that appears on click or on creation of an
// empty node. Commits formula via tr.setNodeMarkup on Enter or blur.
export class MathInlineNodeView implements NodeView {
  dom: HTMLElement;
  private _view: EditorView;
  private _getPos: () => number | undefined;
  private _formula: string;
  private _renderEl: HTMLElement;
  private _inputEl: HTMLInputElement | null = null;
  private _schema: Schema;
  private _renderEndpoint: string;

  constructor(node: PNode, view: EditorView, getPos: any, schema: Schema, renderEndpoint: string) {
    this._view = view;
    this._getPos = getPos;
    this._formula = node.attrs.formula ?? '';
    this._schema = schema;
    this._renderEndpoint = renderEndpoint;

    this.dom = document.createElement('span');
    this.dom.className = 'typst-math-inline-view';

    this._renderEl = document.createElement('span');
    this._renderEl.className = 'math-rendered';
    this.dom.appendChild(this._renderEl);

    this._render();

    // Auto-open input for newly created empty nodes
    if (!this._formula) {
      requestAnimationFrame(() => this._openInput());
    }

    this.dom.addEventListener('click', (e) => {
      e.stopPropagation();
      this._openInput();
    });
  }

  update(node: PNode) {
    if (node.type !== this._schema.nodes.math_inline) return false;
    const newFormula = node.attrs.formula ?? '';
    if (newFormula !== this._formula) {
      this._formula = newFormula;
      this._render();
    }
    return true;
  }

  private _render() {
    if (!this._formula) {
      this._renderEl.innerHTML = `<span class="math-empty">$ $</span>`;
      return;
    }
    const formula = this._formula;
    this._renderEl.innerHTML = `<span class="math-placeholder">$${formula}$</span>`;
    fetchMathHtml(formula, false, this._renderEndpoint).then(html => {
      if (this._formula === formula) this._renderEl.innerHTML = html;
    });
  }

  private _openInput() {
    if (this._inputEl) { this._inputEl.focus(); return; }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'math-inline-input';
    input.value = this._formula;
    input.placeholder = '公式…';

    const rect = this.dom.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - 220);
    input.style.cssText = [
      'position:fixed',
      `left:${left}px`,
      `top:${rect.bottom + 4}px`,
      'z-index:9999',
      'font-family:monospace',
      'font-size:0.9em',
      'padding:4px 8px',
      'border:2px solid var(--accent,#4a7)',
      'border-radius:4px',
      'background:#fff',
      'color:#000',
      'min-width:200px',
      'box-shadow:0 2px 8px rgba(0,0,0,.2)',
      'outline:none',
    ].join(';');

    document.body.appendChild(input);
    this._inputEl = input;
    this.dom.classList.add('math-focused');
    input.focus();
    input.select();

    let committed = false;

    const commit = () => {
      if (committed) return;
      committed = true;
      const formula = input.value.trim();
      const pos = this._getPos();
      if (pos !== undefined) {
        const { state, dispatch } = this._view;
        if (state.doc.nodeAt(pos)?.type === this._schema.nodes.math_inline) {
          dispatch(state.tr.setNodeMarkup(pos, undefined, { formula }));
        }
      }
      cleanup();
    };

    const cleanup = () => {
      if (this._inputEl) {
        document.body.removeChild(this._inputEl);
        this._inputEl = null;
      }
      this.dom.classList.remove('math-focused');
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); this._view.focus(); }
      if (e.key === 'Escape') { e.preventDefault(); cleanup(); this._view.focus(); }
      e.stopPropagation();
    });

    input.addEventListener('blur', () => { if (!committed) commit(); });
  }

  stopEvent() { return false; }
  ignoreMutation() { return true; }

  destroy() {
    if (this._inputEl) {
      document.body.removeChild(this._inputEl);
      this._inputEl = null;
    }
  }
}

// ── MathNodeView (math_block only) ───────────────────────────────────────────
// Mirrors the heading NodeView pattern:
//   cursor inside  → source mode: formula text visible + $ delimiters via CSS
//   cursor outside → rendered mode: MathML shown, formula text collapsed
export class MathBlockNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private _renderEl: HTMLElement;
  private _focused = false;
  private _lastFormula = '';
  private _schema: Schema;
  private _renderEndpoint: string;

  constructor(node: PNode, _view: EditorView, _getPos: any, schema: Schema, renderEndpoint: string) {
    this._schema = schema;
    this._renderEndpoint = renderEndpoint;

    this.dom = document.createElement('div');
    this.dom.className = 'typst-math-block-view';

    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'math-source-text';

    this._renderEl = document.createElement('div');
    this._renderEl.className = 'math-rendered';

    this.dom.appendChild(this.contentDOM);
    this.dom.appendChild(this._renderEl);

    this._applyRendered(node.textContent);
  }

  update(node: PNode, decorations: readonly any[]) {
    if (node.type !== this._schema.nodes.math_block) return false;

    const focused = decorations.some((d: any) => d.spec?.mathFocused);
    const formula = node.textContent;

    if (focused !== this._focused) {
      this._focused = focused;
      focused ? this._applySource() : this._applyRendered(formula);
    } else if (!focused && formula !== this._lastFormula) {
      this._applyRendered(formula);
    }
    return true;
  }

  private _applySource() {
    this.dom.classList.add('math-focused');
    this.contentDOM.style.cssText = 'display:block;min-height:1.2em';
    this._renderEl.style.display = 'none';
  }

  private _applyRendered(formula: string) {
    this._lastFormula = formula;
    this.dom.classList.remove('math-focused');
    this.contentDOM.style.cssText = 'display:block;height:0;overflow:hidden';
    this._renderEl.style.display = '';
    if (!formula) {
      this._renderEl.innerHTML = `<span class="math-empty">$ $</span>`;
      return;
    }
    this._renderEl.innerHTML = `<span class="math-placeholder">$ ${formula} $</span>`;
    fetchMathHtml(formula, true, this._renderEndpoint).then(html => {
      if (!this._focused && this._lastFormula === formula) this._renderEl.innerHTML = html;
    });
  }

  ignoreMutation(mut: any) {
    if (mut.type === 'attributes') return true;
    const target = mut.target;
    if (!target) return false;
    return !(this.contentDOM.contains(target as Node) || target === this.contentDOM);
  }

  destroy() {}
}

// ── Math focus plugin ─────────────────────────────────────────────────────────
// Adds a mathFocused node decoration to the math node containing the cursor.
export const mathFocusPlugin = new Plugin({
  props: {
    decorations(state) {
      const from = state.selection.$from;
      for (let d = from.depth; d >= 0; d--) {
        const n = from.node(d);
        if (n.type.name === 'math_inline' || n.type.name === 'math_block') {
          const start = from.before(d);
          return DecorationSet.create(state.doc, [
            Decoration.node(start, start + n.nodeSize, {}, { mathFocused: true }),
          ]);
        }
      }
      return DecorationSet.empty;
    },
  },
});

// ── Math creation via keydown ────────────────────────────────────────────────
// $formula$  → math_inline  (type closing $, cursor placed after node)
// "$ " + $   → math_block   (dollar-space in empty para, then $; cursor inside)
export function createMathKeyPlugin(schema: Schema) {
  return new Plugin({
    props: {
      handleKeyDown(view, e) {
        if (e.key !== '$' || e.isComposing) return false;
        const { state } = view;
        if (!(state.selection instanceof TextSelection)) return false;
        const cursor = state.selection.$cursor;
        if (!cursor || cursor.parent.type.name !== 'paragraph') return false;

        const textBefore = cursor.parent.textBetween(0, cursor.parentOffset, null, '\ufffc');

        // "$ " (dollar + space) in empty paragraph → empty display math block, cursor inside
        if (/^\$\s+$/.test(textBefore)) {
          const paraStart = cursor.before();
          const paraEnd   = paraStart + cursor.parent.nodeSize;
          const block = schema.nodes.math_block.create(null, []);
          const tr = state.tr.replaceWith(paraStart, paraEnd, block);
          view.dispatch(tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(paraStart) + 1)));
          return true;
        }

        // $formula$ → inline math atom (type closing $, cursor placed after)
        const m = /\$([^$\n]{1,200})$/.exec(textBefore);
        if (m) {
          const formula = m[1].trim();
          if (formula) {
            const start = cursor.pos - m[0].length;
            const inlineNode = schema.nodes.math_inline.create({ formula });
            const tr = state.tr.replaceWith(start, cursor.pos, inlineNode);
            view.dispatch(tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(start) + inlineNode.nodeSize)));
            return true;
          }
        }

        // $$ → empty inline math atom, floating input auto-opens via NodeView constructor
        if (textBefore.endsWith('$')) {
          const start = cursor.pos - 1;
          const inlineNode = schema.nodes.math_inline.create({ formula: '' });
          const tr = state.tr.replaceWith(start, cursor.pos, inlineNode);
          view.dispatch(tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(start) + inlineNode.nodeSize)));
          return true;
        }

        return false;
      },
    },
  });
}

// ── Math node specs ──────────────────────────────────────────────────────────
// Reusable node specs to append to any schema.
export const mathNodeSpecs = {
  math_inline: {
    group: 'inline', inline: true,
    atom: true,
    attrs: { formula: { default: '' } },
    marks: '',
    parseDOM: [{ tag: 'span.typst-math-inline', getAttrs: (dom: any) => ({ formula: dom.dataset?.formula ?? '' }) }],
    toDOM: (node: PNode) => ['span', { class: 'typst-math-inline', 'data-formula': node.attrs.formula }],
  },
  math_block: {
    group: 'block',
    content: 'text*',
    marks: '',
    parseDOM: [{ tag: 'div.typst-math-block' }],
    toDOM: () => ['div', { class: 'typst-math-block' }, 0],
  },
};

// ── Helpers for creating node views bound to a specific schema + endpoint ────
export function createMathNodeViews(schema: Schema, renderEndpoint: string) {
  return {
    math_inline: (node: PNode, view: EditorView, getPos: any) =>
      new MathInlineNodeView(node, view, getPos, schema, renderEndpoint),
    math_block: (node: PNode, view: EditorView, getPos: any) =>
      new MathBlockNodeView(node, view, getPos, schema, renderEndpoint),
  };
}

// ── Math toolbar buttons ─────────────────────────────────────────────────────
export function createMathToolbarItems(schema: Schema) {
  return [
    {
      icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><text x="2" y="10" font-size="9" font-family="serif" fill="currentColor" stroke="none">∑</text><line x1="9" y1="4" x2="13" y2="4"/><line x1="9" y1="7" x2="13" y2="7"/><line x1="9" y1="10" x2="13" y2="10"/></svg>',
      title: '插入行内公式 ($…$)',
      run(view: EditorView) {
        const { state, dispatch } = view;
        const node = schema.nodes.math_inline.create({ formula: '' });
        dispatch(state.tr.replaceSelectionWith(node));
      },
    },
    {
      icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1" y="3" width="12" height="8" rx="1"/><text x="4" y="10" font-size="7" font-family="serif" fill="currentColor" stroke="none">∫</text></svg>',
      title: '插入块级公式 ($$…$$)',
      run(view: EditorView) {
        const { state, dispatch } = view;
        const node = schema.nodes.math_block.create(null, []);
        const from = state.selection.from;
        const tr = state.tr.replaceSelectionWith(node);
        dispatch(tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(from) + 1)));
      },
    },
  ];
}
