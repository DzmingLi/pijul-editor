/**
 * Admonition support for ProseMirror + markdown-it.
 *
 * Handles MkDocs-Material syntax:
 *   !!! note "Title"        → always-open admonition
 *   ??? warning "Title"     → collapsible (closed)
 *   ???+ tip "Title"        → collapsible (open)
 *
 * Body is indented by 4 spaces.
 */

import type { NodeSpec, Node as PNode, Schema } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import type { EditorState } from 'prosemirror-state';
import { Plugin, TextSelection } from 'prosemirror-state';

// ── Constants ──────────────────────────────────────────────────────────────

export const ADMONITION_TYPES = [
  'note', 'abstract', 'info', 'tip', 'success', 'question',
  'warning', 'failure', 'danger', 'bug', 'example', 'quote',
] as const;

export type AdmonitionType = typeof ADMONITION_TYPES[number];

const TYPE_COLORS: Record<string, string> = {
  note:     '#448aff',
  abstract: '#00b0ff',
  info:     '#00b8d4',
  tip:      '#00bfa5',
  success:  '#00c853',
  question: '#64dd17',
  warning:  '#ff9100',
  failure:  '#ff5252',
  danger:   '#ff1744',
  bug:      '#f50057',
  example:  '#7c4dff',
  quote:    '#9e9e9e',
};

function defaultTitle(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// ── ProseMirror NodeSpec ───────────────────────────────────────────────────

export const admonitionNodeSpec: NodeSpec = {
  attrs: {
    type:        { default: 'note' },
    title:       { default: '' },
    collapsible: { default: false },
    open:        { default: true },
  },
  content: 'block+',
  group: 'block',
  defining: true,
  parseDOM: [
    {
      tag: 'div.admonition',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        const cls = el.className.replace('admonition', '').trim();
        const type = ADMONITION_TYPES.find(t => cls.includes(t)) || 'note';
        const titleEl = el.querySelector('.admonition-title');
        return { type, title: titleEl?.textContent || '', collapsible: false, open: true };
      },
      contentElement: (dom) => {
        // Skip the title paragraph, content starts after it
        const el = dom as HTMLElement;
        const titleEl = el.querySelector('.admonition-title');
        if (titleEl) titleEl.remove();
        return el;
      },
    },
    {
      tag: 'details.admonition',
      getAttrs(dom) {
        const el = dom as HTMLDetailsElement;
        const cls = el.className.replace('admonition', '').trim();
        const type = ADMONITION_TYPES.find(t => cls.includes(t)) || 'note';
        const summary = el.querySelector('summary');
        return { type, title: summary?.textContent || '', collapsible: true, open: el.open };
      },
      contentElement: (dom) => {
        const el = dom as HTMLElement;
        const summary = el.querySelector('summary');
        if (summary) summary.remove();
        return el;
      },
    },
  ],
  toDOM(node) {
    const { type, collapsible, open } = node.attrs;
    if (collapsible) {
      const attrs: Record<string, string> = { class: `admonition ${type}` };
      if (open) attrs.open = '';
      return ['details', attrs, ['summary', {}, node.attrs.title || defaultTitle(type)], ['div', { class: 'admonition-body' }, 0]];
    }
    return ['div', { class: `admonition ${type}` }, ['p', { class: 'admonition-title' }, node.attrs.title || defaultTitle(type)], ['div', { class: 'admonition-body' }, 0]];
  },
};

// ── markdown-it plugin ─────────────────────────────────────────────────────

export function markdownItAdmonition(md: any) {
  md.block.ruler.before('fence', 'admonition', admonitionRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
}

function admonitionRule(state: any, startLine: number, endLine: number, silent: boolean): boolean {
  const pos = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const line = state.src.slice(pos, max);

  // Match !!! / ??? / ???+
  let marker: string;
  let rest: string;
  if (line.startsWith('???+ ')) {
    marker = '???+';
    rest = line.slice(5);
  } else if (line.startsWith('??? ')) {
    marker = '???';
    rest = line.slice(4);
  } else if (line.startsWith('!!! ')) {
    marker = '!!!';
    rest = line.slice(4);
  } else {
    return false;
  }

  rest = rest.trim();

  // Extract type (first word)
  const spaceIdx = rest.indexOf(' ');
  const type = spaceIdx >= 0 ? rest.slice(0, spaceIdx) : rest;
  if (!ADMONITION_TYPES.includes(type as any)) return false;

  if (silent) return true;

  // Extract title
  let afterType = spaceIdx >= 0 ? rest.slice(spaceIdx).trim() : '';
  let title: string;
  if (afterType.startsWith('"') && afterType.endsWith('"') && afterType.length >= 2) {
    title = afterType.slice(1, -1);
  } else if (afterType) {
    title = afterType;
  } else {
    title = '';
  }

  // Collect indented body lines
  let nextLine = startLine + 1;
  while (nextLine < endLine) {
    const lineMax = state.eMarks[nextLine];
    const lineText = state.src.slice(state.bMarks[nextLine], lineMax);

    if (lineText.trimEnd() === '') {
      // Blank line — include if more indented content follows
      let hasMore = false;
      for (let k = nextLine + 1; k < endLine; k++) {
        const kText = state.src.slice(state.bMarks[k], state.eMarks[k]);
        if (kText.startsWith('    ') || kText.startsWith('\t')) {
          hasMore = true;
          break;
        } else if (kText.trim() !== '') {
          break;
        }
      }
      if (hasMore) {
        nextLine++;
        continue;
      }
      break;
    } else if (lineText.startsWith('    ') || lineText.startsWith('\t')) {
      nextLine++;
    } else {
      break;
    }
  }

  // Emit tokens
  const tokenOpen = state.push('admonition_open', 'div', 1);
  tokenOpen.block = true;
  tokenOpen.attrSet('type', type);
  tokenOpen.attrSet('title', title);
  tokenOpen.attrSet('collapsible', marker !== '!!!' ? 'true' : 'false');
  tokenOpen.attrSet('open', marker === '???+' ? 'true' : marker === '!!!' ? 'true' : 'false');
  tokenOpen.map = [startLine, nextLine];

  // Parse body with 4-space indent removed
  const oldParent = state.parentType;
  const oldLineMax = state.lineMax;
  state.parentType = 'admonition';

  // Adjust indentation for body lines
  const oldBMarks: number[] = [];
  const oldTShift: number[] = [];
  for (let i = startLine + 1; i < nextLine; i++) {
    oldBMarks.push(state.bMarks[i]);
    oldTShift.push(state.tShift[i]);
    // Remove 4 spaces of indentation
    const lineStart = state.bMarks[i];
    const lineContent = state.src.slice(lineStart, state.eMarks[i]);
    if (lineContent.startsWith('    ')) {
      state.bMarks[i] += 4;
      state.tShift[i] = Math.max(0, state.tShift[i] - 4);
    } else if (lineContent.startsWith('\t')) {
      state.bMarks[i] += 1;
      state.tShift[i] = Math.max(0, state.tShift[i] - 4);
    }
  }

  state.lineMax = nextLine;
  state.md.block.tokenize(state, startLine + 1, nextLine);

  // Restore
  for (let i = startLine + 1; i < nextLine; i++) {
    state.bMarks[i] = oldBMarks[i - startLine - 1];
    state.tShift[i] = oldTShift[i - startLine - 1];
  }

  state.parentType = oldParent;
  state.lineMax = oldLineMax;

  const tokenClose = state.push('admonition_close', 'div', -1);
  tokenClose.block = true;

  state.line = nextLine;
  return true;
}

// ── Parser token map (for prosemirror-markdown) ────────────────────────────

export const admonitionParserTokens = {
  admonition: {
    block: 'admonition',
    getAttrs(tok: any) {
      return {
        type: tok.attrGet('type') || 'note',
        title: tok.attrGet('title') || '',
        collapsible: tok.attrGet('collapsible') === 'true',
        open: tok.attrGet('open') === 'true',
      };
    },
  },
};

// ── Serializer ─────────────────────────────────────────────────────────────

export function serializeAdmonition(state: any, node: PNode) {
  const { type, title, collapsible, open } = node.attrs;
  let marker = '!!!';
  if (collapsible && open) marker = '???+';
  else if (collapsible) marker = '???';

  const displayTitle = title || '';
  if (displayTitle) {
    state.write(`${marker} ${type} "${displayTitle}"\n`);
  } else {
    state.write(`${marker} ${type}\n`);
  }

  // Serialize children with 4-space indent
  const oldOut = state.out;
  state.out = '';
  state.renderContent(node);
  const body = state.out;
  state.out = oldOut;

  // Indent each line by 4 spaces
  const indented = body
    .split('\n')
    .map((line: string) => line ? '    ' + line : '')
    .join('\n');
  state.write(indented);
  state.write('\n');
}

// ── NodeView (WYSIWYG) ────────────────────────────────────────────────────

export function createAdmonitionNodeView(_schema: Schema) {
  return (node: PNode, view: EditorView, getPos: () => number | undefined) => {
    const dom = document.createElement('div');
    dom.className = 'adm-wrap';
    updateAdmStyle(dom, node.attrs);

    // Header bar
    const header = document.createElement('div');
    header.className = 'adm-header';
    header.contentEditable = 'false';

    // Type selector
    const typeSelect = document.createElement('select');
    typeSelect.className = 'adm-type-select';
    for (const t of ADMONITION_TYPES) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = defaultTitle(t);
      if (t === node.attrs.type) opt.selected = true;
      typeSelect.appendChild(opt);
    }
    typeSelect.addEventListener('change', () => {
      const pos = getPos();
      if (pos == null) return;
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        type: typeSelect.value,
      }));
    });

    // Title input
    const titleInput = document.createElement('input');
    titleInput.className = 'adm-title-input';
    titleInput.type = 'text';
    titleInput.placeholder = defaultTitle(node.attrs.type);
    titleInput.value = node.attrs.title || '';
    titleInput.addEventListener('input', () => {
      const pos = getPos();
      if (pos == null) return;
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        title: titleInput.value,
      }));
    });

    // Collapsible toggle
    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'adm-collapse-btn';
    collapseBtn.title = 'Toggle collapsible';
    updateCollapseBtn(collapseBtn, node.attrs);
    collapseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const pos = getPos();
      if (pos == null) return;
      const { collapsible, open } = node.attrs;
      // Cycle: !!! → ??? → ???+ → !!!
      let next: { collapsible: boolean; open: boolean };
      if (!collapsible) {
        next = { collapsible: true, open: false };
      } else if (!open) {
        next = { collapsible: true, open: true };
      } else {
        next = { collapsible: false, open: true };
      }
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...next }));
    });

    header.appendChild(typeSelect);
    header.appendChild(titleInput);
    header.appendChild(collapseBtn);
    dom.appendChild(header);

    // Content area
    const contentDOM = document.createElement('div');
    contentDOM.className = 'adm-body';
    dom.appendChild(contentDOM);

    return {
      dom,
      contentDOM,
      update(updatedNode: PNode) {
        if (updatedNode.type.name !== 'admonition') return false;
        node = updatedNode;
        updateAdmStyle(dom, updatedNode.attrs);
        typeSelect.value = updatedNode.attrs.type;
        titleInput.value = updatedNode.attrs.title || '';
        titleInput.placeholder = defaultTitle(updatedNode.attrs.type);
        updateCollapseBtn(collapseBtn, updatedNode.attrs);
        return true;
      },
      stopEvent(event: Event) {
        // Let select/input events through
        return (event.target === typeSelect || event.target === titleInput || event.target === collapseBtn);
      },
      ignoreMutation(mutation: MutationRecord) {
        return !contentDOM.contains(mutation.target);
      },
    };
  };
}

function updateAdmStyle(dom: HTMLElement, attrs: Record<string, any>) {
  const color = TYPE_COLORS[attrs.type] || TYPE_COLORS.note;
  dom.style.borderLeftColor = color;
  dom.setAttribute('data-adm-type', attrs.type);
  dom.setAttribute('data-adm-collapsible', attrs.collapsible ? '1' : '0');
}

function updateCollapseBtn(btn: HTMLElement, attrs: Record<string, any>) {
  if (!attrs.collapsible) {
    btn.textContent = '!!!';
    btn.title = 'Always open (click to make collapsible)';
  } else if (!attrs.open) {
    btn.textContent = '???';
    btn.title = 'Collapsed by default (click to expand by default)';
  } else {
    btn.textContent = '???+';
    btn.title = 'Expanded by default (click to make non-collapsible)';
  }
}

// ── Input plugin: auto-convert `!!! ` / `??? ` / `???+ ` at line start ────

const ADMONITION_PREFIX_RE = /^(\?\?\?\+|\?\?\?|!!!) $/;

export function createAdmonitionKeyPlugin(schema: Schema) {
  const admType = schema.nodes.admonition;
  if (!admType) return new Plugin({});

  return new Plugin({
    props: {
      handleKeyDown(view, e) {
        if (e.key !== ' ') return false;
        const { state } = view;
        const sel = state.selection;
        if (!(sel instanceof TextSelection)) return false;
        const cursor = sel.$cursor;
        if (!cursor || cursor.parent.type.name !== 'paragraph') return false;

        const text = cursor.parent.textContent + ' '; // include the space about to be typed
        if (cursor.parentOffset !== text.length - 1) return false;

        const match = ADMONITION_PREFIX_RE.exec(text);
        if (!match) return false;

        const marker = match[1];
        const collapsible = marker !== '!!!';
        const open = marker === '???+' || marker === '!!!';

        const nodePos = cursor.before();
        const nodeEnd = nodePos + cursor.parent.nodeSize;

        const admNode = admType.create(
          { type: 'note', title: '', collapsible, open },
          state.schema.nodes.paragraph.create(),
        );

        view.dispatch(state.tr.replaceWith(nodePos, nodeEnd, admNode));
        // Move cursor into the admonition body
        requestAnimationFrame(() => {
          const newState = view.state;
          // The admonition is at nodePos, its body paragraph starts at nodePos+1 (admonition open) + 1 (paragraph open)
          const bodyPos = nodePos + 2;
          if (bodyPos <= newState.doc.content.size) {
            view.dispatch(newState.tr.setSelection(TextSelection.create(newState.doc, bodyPos)));
            view.focus();
          }
        });

        return true;
      },
    },
  });
}

// ── Toolbar items ──────────────────────────────────────────────────────────

export function createAdmonitionToolbarItem(schema: Schema, label: string) {
  return {
    icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1" y="1.5" width="12" height="11" rx="1.5"/><line x1="1" y1="4.5" x2="13" y2="4.5"/><circle cx="3.5" cy="3" r="0.8" fill="currentColor" stroke="none"/></svg>',
    title: label,
    run(view: EditorView) {
      const { state, dispatch } = view;
      const adm = schema.nodes.admonition;
      if (!adm) return;
      const node = adm.create(
        { type: 'note', title: '', collapsible: false, open: true },
        schema.nodes.paragraph.create(),
      );
      dispatch(state.tr.replaceSelectionWith(node));
      view.focus();
    },
    active(state: EditorState) {
      const { $from } = state.selection;
      for (let d = $from.depth; d >= 0; d--) {
        if ($from.node(d).type.name === 'admonition') return true;
      }
      return false;
    },
  };
}
