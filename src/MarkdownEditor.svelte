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

  // ── Module-level singletons ──────────────────────────────────────────────
  // Constructed once, shared across all MarkdownEditor instances.

  const baseNodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block');
  export const mdSchema = new Schema({
    nodes: (baseNodes as any)
      .append(tableNodes({ tableGroup: 'block', cellContent: 'block+', cellAttributes: {} }))
      .append(mathNodeSpecs),
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

  const mdParser = new MarkdownParser(mdSchema, tokenizer, {
    ...defaultMarkdownParser.tokens,
    table: { block: 'table' },
    tr: { block: 'table_row' },
    th: { block: 'table_header' },
    td: { block: 'table_cell' },
  });

  const mdSerializer = new MarkdownSerializer(
    {
      ...defaultMarkdownSerializer.nodes,
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
    return mdSerializer.serialize(doc);
  }

  const mdMathPlugins = [mathFocusPlugin, createMathKeyPlugin(mdSchema)];
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
  const mathToolbar = createMathToolbarItems(mdSchema, i.toolbar);
</script>

<ProseEditorBase
  bind:value
  {placeholder}
  {fillHeight}
  schema={mdSchema}
  plugins={mdMathPlugins}
  nodeViews={mathNodeViews}
  serialize={serializeMd}
  parse={parseMd}
  headingPrefixes={['# ', '## ', '### ']}
  toolbarItems={mathToolbar}
  {locale}
  {onImageUpload}
/>

<style>
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
</style>
