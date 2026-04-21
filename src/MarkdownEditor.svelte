<script module lang="ts">
  import { Schema } from 'prosemirror-model';
  import { schema as basicSchema } from 'prosemirror-schema-basic';
  import { addListNodes } from 'prosemirror-schema-list';
  import { defaultMarkdownParser, defaultMarkdownSerializer, MarkdownParser, MarkdownSerializer } from 'prosemirror-markdown';
  import { tableNodes } from 'prosemirror-tables';
  import type { Node as PNode } from 'prosemirror-model';
  import {
    mathNodeSpecs, mathFocusPlugin, createMathKeyPlugin,
    createMathNodeViews, createMathToolbarItems,
  } from './mathSupport';
  import {
    admonitionNodeSpec, markdownItAdmonition, admonitionParserTokens,
    serializeAdmonition, createAdmonitionNodeView, createAdmonitionToolbarItem,
    createAdmonitionKeyPlugin,
  } from './admonitionSupport';
  import { linkInputRule, linkPopoverPlugin } from './linkSupport';
  import { inputRules } from 'prosemirror-inputrules';

  // ── Module-level singletons ──────────────────────────────────────────────
  // Constructed once, shared across all MarkdownEditor instances.

  const baseNodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block');
  export const mdSchema = new Schema({
    nodes: (baseNodes as any)
      .append(tableNodes({ tableGroup: 'block', cellContent: 'inline*', cellAttributes: {} }))
      .append(mathNodeSpecs)
      .append({ admonition: admonitionNodeSpec }),
    marks: basicSchema.spec.marks,
  });

  // Enable GFM table extension on the markdown-it tokenizer
  const tokenizer = defaultMarkdownParser.tokenizer.enable('table');

  // Strip thead/tbody wrappers from markdown-it output so that
  // prosemirror-markdown sees tr/th/td as direct children of table.
  // (ignore:true would skip ALL children including the actual rows.)
  function stripTableWrappers(md: any) {
    md.core.ruler.push('strip_thead_tbody', (state: any) => {
      state.tokens = state.tokens.filter(
        (tok: any) => !['thead_open','thead_close','tbody_open','tbody_close'].includes(tok.type)
      );
    });
  }
  tokenizer.use(stripTableWrappers);
  tokenizer.use(markdownItAdmonition);

  const mdParser = new MarkdownParser(mdSchema, tokenizer, {
    ...defaultMarkdownParser.tokens,
    ...admonitionParserTokens,
    table: { block: 'table' },
    tr: { block: 'table_row' },
    th: { block: 'table_header' },
    td: { block: 'table_cell' },
  });

  const mdSerializer = new MarkdownSerializer(
    {
      ...defaultMarkdownSerializer.nodes,
      // Use '-' for bullet lists (not '*') and don't add blank lines between items
      bullet_list(state, node) {
        state.renderList(node, '  ', () => '- ');
      },
      ordered_list(state, node) {
        const start = node.attrs.order || 1;
        state.renderList(node, '  ', (i: number) => `${start + i}. `);
      },
      list_item(state, node) {
        state.renderContent(node);
      },
      math_inline(state, node) {
        state.write(`$${node.attrs.formula}$`);
      },
      math_block(state, node) {
        state.write('$$\n');
        state.write(node.textContent);
        state.write('\n$$\n\n');
      },
      table(state, node) {
        const rows: string[][] = [];
        node.forEach(row => {
          const cells: string[] = [];
          row.forEach(cell => {
            cells.push(cell.textContent.replace(/\|/g, '\\|').replace(/\n/g, ' '));
          });
          rows.push(cells);
        });
        if (rows.length === 0) return;
        state.write('| ' + rows[0].join(' | ') + ' |\n');
        state.write('| ' + rows[0].map(() => '---').join(' | ') + ' |\n');
        for (let i = 1; i < rows.length; i++) {
          state.write('| ' + rows[i].join(' | ') + ' |\n');
        }
        state.write('\n');
      },
      table_row()    {},
      table_cell()   {},
      table_header() {},
      admonition: serializeAdmonition,
    },
    defaultMarkdownSerializer.marks,
  );

  // ── Parse: markdown → doc ──────────────────────────────────────────────────
  // Handle $...$ (inline) and $$...$$ (block) math before passing to prosemirror-markdown.
  export function parseMd(text: string): PNode {
    try {
      // Pre-process: convert $$...$$ blocks into HTML div markers that prosemirror
      // can parse, and $...$ inline into span markers.
      // For block math: $$\nformula\n$$ → <div class="typst-math-block">formula</div>
      let processed = text.replace(/\$\$\n([\s\S]*?)\n\$\$/g, (_m, formula) => {
        return `<div class="typst-math-block">${formula}</div>`;
      });
      // For inline math: $formula$ → <span class="typst-math-inline" data-formula="formula"></span>
      // Avoid matching $$ and escaped \$
      processed = processed.replace(/(?<!\$)\$([^$\n]+?)\$(?!\$)/g, (_m, formula) => {
        return `<span class="typst-math-inline" data-formula="${formula.replace(/"/g, '&quot;')}"></span>`;
      });
      return mdParser.parse(processed) ?? mdSchema.topNodeType.createAndFill()!;
    } catch { return mdSchema.topNodeType.createAndFill()!; }
  }

  export function serializeMd(doc: PNode): string {
    const out = mdSerializer.serialize(doc);
    // Ensure trailing newline (standard for text files)
    return out.endsWith('\n') ? out : out + '\n';
  }

  // Input rules specific to markdown (auto-convert `[text](url)` to a
  // link mark before the serializer would escape the brackets).
  const mdLinkInputRule = linkInputRule(mdSchema);
  const mdInputRules = mdLinkInputRule
    ? inputRules({ rules: [mdLinkInputRule] })
    : null;
  const mdLinkPopover = linkPopoverPlugin(mdSchema);

  const mdMathPlugins = [
    mathFocusPlugin,
    createMathKeyPlugin(mdSchema),
    createAdmonitionKeyPlugin(mdSchema),
    ...(mdInputRules ? [mdInputRules] : []),
    ...(mdLinkPopover ? [mdLinkPopover] : []),
  ];
</script>

<script lang="ts">
  import ProseEditorBase from './ProseEditorBase.svelte';

  import { getLocale } from './i18n/index';

  let { value = $bindable(''), placeholder = '', fillHeight = false, renderEndpoint = '/api/render/latex-snippet', locale = 'zh', onImageUpload }: {
    value: string; placeholder?: string; fillHeight?: boolean; renderEndpoint?: string; locale?: string;
    onImageUpload?: (file: File) => Promise<{ src: string; alt?: string }>;
  } = $props();

  let i = $derived(getLocale(locale));
  const mathNodeViews = createMathNodeViews(mdSchema, renderEndpoint, i.math.placeholder);
  const admNodeViews = createAdmonitionNodeView(mdSchema);
  const mathToolbar = createMathToolbarItems(mdSchema, i.toolbar);
  const admToolbar = createAdmonitionToolbarItem(mdSchema, i.toolbar.admonition ?? 'Admonition');
</script>

<ProseEditorBase
  bind:value
  {placeholder}
  {fillHeight}
  schema={mdSchema}
  plugins={mdMathPlugins}
  nodeViews={{ ...mathNodeViews, admonition: admNodeViews }}
  serialize={serializeMd}
  parse={parseMd}
  headingPrefixes={['# ', '## ', '### ']}
  toolbarItems={[...mathToolbar, admToolbar]}
  {locale}
  {onImageUpload}
/>

<style>
  /* ── Link edit popover ── */
  :global(.pm-link-popover) {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    background: var(--bg-white, #fff);
    border: 1px solid var(--border, #d4d4d4);
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    font-size: 12px;
    max-width: min(420px, 90vw);
  }
  :global(.pm-link-popover-input) {
    flex: 1;
    min-width: 160px;
    padding: 3px 6px;
    font-size: 12px;
    font-family: var(--font-mono, monospace);
    border: 1px solid var(--border, #d4d4d4);
    border-radius: 3px;
    background: var(--bg-white, #fff);
    color: var(--text-primary, #111);
    outline: none;
  }
  :global(.pm-link-popover-input:focus) {
    border-color: var(--accent, #5f9b65);
  }
  :global(.pm-link-popover-open),
  :global(.pm-link-popover-unlink) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    background: none;
    border-radius: 3px;
    cursor: pointer;
    color: var(--text-secondary, #555);
    text-decoration: none;
    font-size: 14px;
  }
  :global(.pm-link-popover-open:hover),
  :global(.pm-link-popover-unlink:hover) {
    background: var(--bg-hover, #f0f0f0);
    color: var(--accent, #5f9b65);
  }
  :global(.pm-link-popover-unlink:hover) { color: #c00; }

  /* ── Math node wrapper ── */
  :global(.typst-math-inline-view) {
    display: inline-block;
    vertical-align: middle;
    position: relative;
    border-radius: 3px;
    cursor: text;
  }
  :global(.typst-math-block-view) {
    display: block;
    position: relative;
    border-radius: 4px;
    margin: 0.75em 0;
    text-align: center;
    cursor: text;
  }
  :global(.typst-math-inline-view.math-focused) {
    outline: 2px solid var(--accent, #4a7);
    outline-offset: 2px;
    background: rgba(95, 155, 101, 0.06);
  }
  :global(.typst-math-block-view.math-focused) {
    outline: 2px solid var(--accent, #4a7);
    outline-offset: 2px;
    background: rgba(95, 155, 101, 0.06);
    text-align: left;
  }
  :global(.typst-math-inline-view.math-focused .math-source-text::before) { content: '$'; color: #888; user-select: none; }
  :global(.typst-math-inline-view.math-focused .math-source-text::after)  { content: '$'; color: #888; user-select: none; }
  :global(.typst-math-block-view.math-focused  .math-source-text::before) { content: '$ '; color: #888; user-select: none; }
  :global(.typst-math-block-view.math-focused  .math-source-text::after)  { content: ' $'; color: #888; user-select: none; }
  :global(.math-source-text) {
    font-family: var(--font-mono, monospace);
    font-size: 0.88em;
    color: #2a6b4a;
    white-space: pre-wrap;
  }
  :global(.math-rendered) { display: inline-block; }
  :global(.typst-math-block-view .math-rendered) { display: block; }
  :global(.math-empty) {
    font-family: var(--font-mono, monospace);
    font-size: 0.88em;
    color: var(--text-hint, #aaa);
    background: rgba(42, 107, 74, 0.04);
    border-radius: 3px;
    padding: 0 4px;
    border: 1px dashed rgba(42, 107, 74, 0.3);
  }
  :global(.math-placeholder),
  :global(.math-fallback) {
    font-family: var(--font-mono, monospace);
    font-size: 0.88em;
    color: #2a6b4a;
    background: rgba(42, 107, 74, 0.07);
    border-radius: 3px;
    padding: 0 4px;
  }
  :global(.typst-math-inline-view svg),
  :global(.typst-math-block-view svg) { vertical-align: middle; max-width: 100%; height: auto; }
  :global(.math-inline-input) {
    font-family: var(--font-mono, monospace) !important;
    font-size: 0.9em !important;
  }

  /* ── Admonition NodeView ── */
  :global(.adm-wrap) {
    border-left: 3px solid #448aff;
    border-radius: 0 4px 4px 0;
    margin: 1em 0;
    background: rgba(0, 0, 0, 0.015);
  }
  :global(.adm-header) {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
    background: rgba(0, 0, 0, 0.02);
    border-radius: 0 4px 0 0;
  }
  :global(.adm-type-select) {
    font-size: 12px;
    font-weight: 600;
    padding: 2px 4px;
    border: 1px solid var(--border, #ddd);
    border-radius: 3px;
    background: var(--bg-white, white);
    color: inherit;
    cursor: pointer;
    font-family: var(--font-sans, sans-serif);
  }
  :global(.adm-title-input) {
    flex: 1;
    font-size: 13px;
    font-weight: 500;
    padding: 2px 6px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: inherit;
    font-family: var(--font-sans, sans-serif);
    outline: none;
    min-width: 0;
  }
  :global(.adm-title-input:focus) {
    border-color: var(--border, #ddd);
    background: var(--bg-white, white);
  }
  :global(.adm-title-input::placeholder) {
    color: var(--text-hint, #aaa);
    font-weight: 400;
  }
  :global(.adm-collapse-btn) {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    font-weight: 600;
    padding: 2px 6px;
    border: 1px solid var(--border, #ddd);
    border-radius: 3px;
    background: var(--bg-white, white);
    color: var(--text-secondary, #666);
    cursor: pointer;
    white-space: nowrap;
    line-height: 1;
  }
  :global(.adm-collapse-btn:hover) {
    border-color: var(--accent, #4a7);
    color: var(--accent, #4a7);
  }
  :global(.adm-body) {
    padding: 0.5em 1em 0.75em;
  }
  :global(.adm-body > p:first-child) { margin-top: 0; }
  :global(.adm-body > p:last-child) { margin-bottom: 0; }

  /* Admonition type colors in editor */
  :global(.adm-wrap[data-adm-type="note"])     { border-left-color: #448aff; }
  :global(.adm-wrap[data-adm-type="abstract"]) { border-left-color: #00b0ff; }
  :global(.adm-wrap[data-adm-type="info"])     { border-left-color: #00b8d4; }
  :global(.adm-wrap[data-adm-type="tip"])      { border-left-color: #00bfa5; }
  :global(.adm-wrap[data-adm-type="success"])  { border-left-color: #00c853; }
  :global(.adm-wrap[data-adm-type="question"]) { border-left-color: #64dd17; }
  :global(.adm-wrap[data-adm-type="warning"])  { border-left-color: #ff9100; }
  :global(.adm-wrap[data-adm-type="failure"])  { border-left-color: #ff5252; }
  :global(.adm-wrap[data-adm-type="danger"])   { border-left-color: #ff1744; }
  :global(.adm-wrap[data-adm-type="bug"])      { border-left-color: #f50057; }
  :global(.adm-wrap[data-adm-type="example"])  { border-left-color: #7c4dff; }
  :global(.adm-wrap[data-adm-type="quote"])    { border-left-color: #9e9e9e; }
</style>
