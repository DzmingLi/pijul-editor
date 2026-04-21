// Link support for the markdown editor:
//   1. Typing `[text](url)` auto-converts to a link mark (so the serializer
//      doesn't escape the brackets and emit broken literal text).
//   2. Clicking a link inside the editor pops a small edit panel with
//      text + href inputs plus an "unlink" button.
//
// Without (1) the WYSIWYG path round-trips `[x](y)` into `\[x\](y)` —
// see the 三次握手 answer bug where every link rendered as literal
// `[Selecting Sequence Numbers]` followed by an auto-linked URL.

import { InputRule } from 'prosemirror-inputrules';
import { Plugin, PluginKey } from 'prosemirror-state';
import type { Schema, MarkType } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

// ── Input rule ───────────────────────────────────────────────────────────

/** Match `[text](url)` at the end of the current block and replace with
 *  a `text` text node carrying a `link(href=url)` mark. Fires on the
 *  closing `)` character. URL may be any non-whitespace run. */
export function linkInputRule(schema: Schema): InputRule | null {
  const linkMark = schema.marks.link;
  if (!linkMark) return null;
  return new InputRule(
    /\[([^\]\n]+)\]\(([^)\s]+)\)$/,
    (state, match, start, end) => {
      const [, text, href] = match;
      if (!text || !href) return null;
      const mark = linkMark.create({ href });
      const node = schema.text(text, [mark]);
      return state.tr.replaceWith(start, end, node);
    },
  );
}

// ── Click-to-edit popover ────────────────────────────────────────────────

const LINK_POPOVER_KEY = new PluginKey('link-popover');

interface PopoverState {
  anchor: HTMLElement;
  input: HTMLInputElement;
  unlinkBtn: HTMLButtonElement;
  openBtn: HTMLAnchorElement;
  from: number;
  to: number;
  href: string;
}

/** Find the range [from, to) that covers the contiguous link-marked text
 *  around `pos`, and return the href. Returns null if pos isn't in a link. */
function findLinkAt(state: any, pos: number, linkMark: MarkType): { from: number; to: number; href: string } | null {
  const $pos = state.doc.resolve(pos);
  const marks = $pos.marks();
  const mark = marks.find((m: any) => m.type === linkMark);
  if (!mark) return null;

  // Walk outward from $pos until the link mark ends.
  let from = pos, to = pos;
  state.doc.nodesBetween($pos.start(), $pos.end(), (node: any, nodePos: number) => {
    if (!node.isText) return;
    const hasMark = linkMark.isInSet(node.marks);
    if (!hasMark) return;
    const nodeFrom = nodePos;
    const nodeTo = nodePos + node.nodeSize;
    if (nodeTo > pos && nodeFrom < pos) {
      from = Math.min(from, nodeFrom);
      to = Math.max(to, nodeTo);
    } else if (nodeFrom === to || nodeTo === from) {
      // contiguous link-marked sibling
      from = Math.min(from, nodeFrom);
      to = Math.max(to, nodeTo);
    }
  });

  return { from, to, href: mark.attrs.href };
}

/** Build the popover DOM once per editor. We reposition + update its
 *  state instead of recreating it. */
function createPopover(view: EditorView, linkMark: MarkType): PopoverState {
  const anchor = document.createElement('div');
  anchor.className = 'pm-link-popover';
  anchor.style.position = 'absolute';
  anchor.style.display = 'none';
  anchor.style.zIndex = '50';

  const input = document.createElement('input');
  input.type = 'url';
  input.placeholder = 'https://...';
  input.className = 'pm-link-popover-input';

  const openBtn = document.createElement('a');
  openBtn.target = '_blank';
  openBtn.rel = 'noopener noreferrer';
  openBtn.className = 'pm-link-popover-open';
  openBtn.textContent = '↗';
  openBtn.title = 'Open in new tab';

  const unlinkBtn = document.createElement('button');
  unlinkBtn.type = 'button';
  unlinkBtn.className = 'pm-link-popover-unlink';
  unlinkBtn.textContent = '✕';
  unlinkBtn.title = 'Remove link';

  anchor.appendChild(openBtn);
  anchor.appendChild(input);
  anchor.appendChild(unlinkBtn);

  // Mount into the same positioned ancestor as the editor DOM so the
  // popover's absolute coords line up with the editor.
  const host = view.dom.parentElement ?? document.body;
  host.style.position ||= 'relative';
  host.appendChild(anchor);

  const state: PopoverState = { anchor, input, unlinkBtn, openBtn, from: 0, to: 0, href: '' };

  // Commit a new href when the user presses Enter or blurs the field.
  const commit = () => {
    const next = input.value.trim();
    if (next === state.href) return;
    if (state.from === state.to) return;
    const mark = linkMark.create({ href: next || state.href });
    const tr = view.state.tr;
    tr.removeMark(state.from, state.to, linkMark);
    if (next) tr.addMark(state.from, state.to, mark);
    view.dispatch(tr);
    state.href = next;
    openBtn.href = next;
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); view.focus(); }
    if (e.key === 'Escape') { anchor.style.display = 'none'; view.focus(); }
  });
  input.addEventListener('blur', commit);

  unlinkBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (state.from === state.to) return;
    view.dispatch(view.state.tr.removeMark(state.from, state.to, linkMark));
    anchor.style.display = 'none';
    view.focus();
  });

  return state;
}

/** Plugin: shows a popover whenever the cursor is inside a link mark, or
 *  whenever the user clicks a link. Typing inside the link keeps the
 *  popover open (so you can see/edit the href live). */
export function linkPopoverPlugin(schema: Schema): Plugin | null {
  const linkMark = schema.marks.link;
  if (!linkMark) return null;

  let popover: PopoverState | null = null;

  function updatePopover(view: EditorView) {
    if (!popover) return;
    const { state } = view;
    const pos = state.selection.from;
    const info = findLinkAt(state, pos, linkMark);
    if (!info) {
      popover.anchor.style.display = 'none';
      return;
    }
    // Position below the link's start coordinate.
    const coords = view.coordsAtPos(info.from);
    const hostRect = popover.anchor.parentElement!.getBoundingClientRect();
    popover.anchor.style.display = 'flex';
    popover.anchor.style.left = `${coords.left - hostRect.left}px`;
    popover.anchor.style.top = `${coords.bottom - hostRect.top + 4}px`;
    if (document.activeElement !== popover.input) {
      popover.input.value = info.href;
    }
    popover.from = info.from;
    popover.to = info.to;
    popover.href = info.href;
    popover.openBtn.href = info.href;
  }

  return new Plugin({
    key: LINK_POPOVER_KEY,
    view(editorView) {
      popover = createPopover(editorView, linkMark);
      updatePopover(editorView);
      return {
        update(view) { updatePopover(view); },
        destroy() {
          popover?.anchor.remove();
          popover = null;
        },
      };
    },
    props: {
      // Cmd/Ctrl-click a link to open it (ProseMirror swallows plain
      // clicks on purpose so the editor can handle selection).
      handleClickOn(_view, _pos, node, _nodePos, event) {
        if (!(event.ctrlKey || event.metaKey)) return false;
        const mark = node.marks.find(m => m.type === linkMark);
        if (!mark) return false;
        window.open(mark.attrs.href, '_blank', 'noopener');
        return true;
      },
    },
  });
}
