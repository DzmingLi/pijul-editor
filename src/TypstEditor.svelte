<script module lang="ts">
  import { Schema, type Node as PNode } from 'prosemirror-model';
  import { schema as basicSchema } from 'prosemirror-schema-basic';
  import { addListNodes } from 'prosemirror-schema-list';
  import { tableNodes } from 'prosemirror-tables';
  import { inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
  import { TextSelection } from 'prosemirror-state';
  import {
    mathNodeSpecs, mathFocusPlugin, createMathKeyPlugin,
    createMathNodeViews, createMathToolbarItems,
  } from './mathSupport';

  // ── Schema ───────────────────────────────────────────────────────────────────
  const baseNodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block');
  export const typstSchema = new Schema({
    nodes: (baseNodes as any)
      .append(tableNodes({ tableGroup: 'block', cellContent: 'block+', cellAttributes: {} }))
      .append(mathNodeSpecs),
    marks: basicSchema.spec.marks,
  });

  // ── Plugins & node views ─────────────────────────────────────────────────────
  export const typstPlugins = [
    mathFocusPlugin,
    createMathKeyPlugin(typstSchema),
    inputRules({ rules: [
      textblockTypeInputRule(/^(={1,6})\s$/, typstSchema.nodes.heading, (m: RegExpMatchArray) => ({ level: m[1].length })),
      wrappingInputRule(/^\+\s$/, typstSchema.nodes.ordered_list),
    ]}),
  ];

  // ── Serializer: doc → Typst ──────────────────────────────────────────────────
  function serializeInline(node: PNode): string {
    if (node.type.name === 'math_inline') return `$${node.attrs.formula}$`;
    if (node.isText) {
      let s = node.text ?? '';
      const marks = node.marks.map(m => m.type.name);
      if (marks.includes('strong')) s = `*${s}*`;
      if (marks.includes('em'))     s = `_${s}_`;
      if (marks.includes('code'))   s = '`' + s + '`';
      return s;
    }
    let out = ''; node.forEach(c => { out += serializeInline(c); }); return out;
  }

  function serializeBlock(node: PNode): string {
    switch (node.type.name) {
      case 'paragraph': {
        let s = ''; node.forEach(c => { s += serializeInline(c); }); return s + '\n';
      }
      case 'heading': {
        let s = ''; node.forEach(c => { s += serializeInline(c); });
        return '='.repeat(node.attrs.level) + ' ' + s + '\n';
      }
      case 'bullet_list': {
        let out = '';
        node.forEach(item => {
          let s = '';
          item.forEach(c => { if (c.type.name === 'paragraph') c.forEach(i => { s += serializeInline(i); }); });
          out += `- ${s}\n`;
        });
        return out;
      }
      case 'ordered_list': {
        let out = '';
        node.forEach(item => {
          let s = '';
          item.forEach(c => { if (c.type.name === 'paragraph') c.forEach(i => { s += serializeInline(i); }); });
          out += `+ ${s}\n`;
        });
        return out;
      }
      case 'blockquote': {
        let s = '';
        node.forEach(c => { if (c.type.name === 'paragraph') c.forEach(i => { s += serializeInline(i); }); });
        return `#quote[${s}]\n`;
      }
      case 'code_block':      return '```\n' + node.textContent + '\n```\n';
      case 'horizontal_rule': return '---\n';
      case 'math_block': {
        const f = node.textContent;
        return f.includes('\n') ? '$\n' + f + '\n$\n' : '$ ' + f + ' $\n';
      }
      case 'table': {
        const firstRow = node.firstChild;
        if (!firstRow) return '';
        const cols = firstRow.childCount;
        const cells: string[] = [];
        node.forEach(row => { row.forEach(cell => { cells.push('[' + cell.textContent.replace(/]/g, '\\]') + ']'); }); });
        return `#table(columns: ${cols},\n  ${cells.join(', ')},\n)\n`;
      }
      default: { let out = ''; node.forEach(c => { out += serializeBlock(c); }); return out; }
    }
  }

  export function serializeTypst(doc: PNode): string {
    let out = '';
    doc.forEach(block => { out += serializeBlock(block) + '\n'; });
    return out.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  }

  // ── Parser: Typst → doc ──────────────────────────────────────────────────────
  function mathInline(formula: string): PNode {
    return typstSchema.nodes.math_inline.create({ formula });
  }
  function mathBlock(formula: string): PNode {
    return typstSchema.nodes.math_block.create(null, formula ? [typstSchema.text(formula)] : []);
  }

  function parseInline(text: string): PNode[] {
    const nodes: PNode[] = [];
    let i = 0, plain = '';
    const flush = () => { if (plain) { nodes.push(typstSchema.text(plain)); plain = ''; } };
    while (i < text.length) {
      const rest = text.slice(i);
      const mathM = rest.match(/^\$([^$\n]+)\$/);
      if (mathM) { flush(); nodes.push(mathInline(mathM[1])); i += mathM[0].length; continue; }
      const boldM = rest.match(/^\*([^*\n]+)\*/);
      if (boldM) { flush(); nodes.push(typstSchema.text(boldM[1], [typstSchema.marks.strong.create()])); i += boldM[0].length; continue; }
      const emM = rest.match(/^_([^_\n]+)_/);
      if (emM) { flush(); nodes.push(typstSchema.text(emM[1], [typstSchema.marks.em.create()])); i += emM[0].length; continue; }
      const codeM = rest.match(/^`([^`\n]+)`/);
      if (codeM) { flush(); nodes.push(typstSchema.text(codeM[1], [typstSchema.marks.code.create()])); i += codeM[0].length; continue; }
      plain += text[i++];
    }
    flush();
    return nodes.length ? nodes : [typstSchema.text(' ')];
  }

  export function parseTypst(text: string): PNode {
    try {
      const blocks: PNode[] = [];
      const lines = text.split('\n');
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) { i++; continue; }

        const hm = line.match(/^(={1,6})\s+(.*)/);
        if (hm) { blocks.push(typstSchema.nodes.heading.create({ level: hm[1].length }, parseInline(hm[2]))); i++; continue; }

        if (/^- /.test(line)) {
          const items: PNode[] = [];
          while (i < lines.length && /^- /.test(lines[i]))
            items.push(typstSchema.nodes.list_item.create(null, [typstSchema.nodes.paragraph.create(null, parseInline(lines[i++].slice(2)))]));
          blocks.push(typstSchema.nodes.bullet_list.create(null, items)); continue;
        }

        if (/^\+ /.test(line)) {
          const items: PNode[] = [];
          while (i < lines.length && /^\+ /.test(lines[i]))
            items.push(typstSchema.nodes.list_item.create(null, [typstSchema.nodes.paragraph.create(null, parseInline(lines[i++].slice(2)))]));
          blocks.push(typstSchema.nodes.ordered_list.create(null, items)); continue;
        }

        if (line.trim() === '```') {
          i++;
          const codeLines: string[] = [];
          while (i < lines.length && lines[i].trim() !== '```') codeLines.push(lines[i++]);
          if (i < lines.length) i++;
          blocks.push(typstSchema.nodes.code_block.create(null, codeLines.length ? [typstSchema.text(codeLines.join('\n'))] : [])); continue;
        }

        // Single-line display math: $ formula $
        const sdm = line.match(/^\$ (.+) \$\s*$/);
        if (sdm) { blocks.push(mathBlock(sdm[1])); i++; continue; }

        // Multi-line display math: $ on its own line
        if (line.trim() === '$') {
          i++;
          const fLines: string[] = [];
          while (i < lines.length && lines[i].trim() !== '$') fLines.push(lines[i++]);
          if (i < lines.length) i++;
          blocks.push(mathBlock(fLines.join('\n'))); continue;
        }

        if (line.trim() === '---') { blocks.push(typstSchema.nodes.horizontal_rule.create()); i++; continue; }

        // #table(columns: N, ...) or #table(\n  columns: (...), ...)
        if (/^#table\(/.test(line)) {
          // Collect all lines until closing )
          let tableText = line;
          while (!tableText.trimEnd().endsWith(')') && i + 1 < lines.length) {
            i++;
            tableText += '\n' + lines[i];
          }
          i++;
          // Determine column count: either a plain number or a tuple like (4cm, 1fr)
          let cols = 0;
          const colNumM = tableText.match(/columns:\s*(\d+)/);
          if (colNumM) {
            cols = parseInt(colNumM[1], 10);
          } else {
            const colTupleM = tableText.match(/columns:\s*\(([^)]+)\)/);
            if (colTupleM) cols = colTupleM[1].split(',').length;
          }
          if (cols < 1) cols = 1;
          // Extract cells: both [bracket] and "quoted" content
          const cellTexts: string[] = [];
          for (const m of tableText.matchAll(/\[([^\]]*)\]|"([^"]*)"/g)) {
            cellTexts.push((m[1] ?? m[2] ?? '').replace(/\\]/g, ']'));
          }
          const rowCount = Math.max(1, Math.ceil(cellTexts.length / cols));
          const rows: PNode[] = [];
          for (let r = 0; r < rowCount; r++) {
            const cells: PNode[] = [];
            for (let c = 0; c < cols; c++) {
              const text = cellTexts[r * cols + c] ?? '';
              const cellType = r === 0 ? typstSchema.nodes.table_header : typstSchema.nodes.table_cell;
              cells.push(cellType.create(null, [typstSchema.nodes.paragraph.create(null, text ? parseInline(text) : [])]));
            }
            rows.push(typstSchema.nodes.table_row.create(null, cells));
          }
          blocks.push(typstSchema.nodes.table.create(null, rows));
          continue;
        }

        const qm = line.match(/^#quote\[(.+)\]$/);
        if (qm) { blocks.push(typstSchema.nodes.blockquote.create(null, [typstSchema.nodes.paragraph.create(null, parseInline(qm[1]))])); i++; continue; }

        const paraLines: string[] = [];
        while (i < lines.length) {
          const l = lines[i];
          if (!l.trim()) break;
          if (/^(={1,6}\s|```$|\$\s*$|\$ .+ \$\s*$|---$|#quote\[|#table\()/.test(l)) break;
          if (/^[+-] /.test(l) && paraLines.length > 0) break;
          paraLines.push(l); i++;
        }
        if (paraLines.length) {
          blocks.push(typstSchema.nodes.paragraph.create(null, parseInline(paraLines.join('\n'))));
        } else {
          // Safety: skip unrecognized lines to prevent infinite loops
          i++;
        }
      }
      if (!blocks.length) blocks.push(typstSchema.nodes.paragraph.create());
      return typstSchema.nodes.doc.create(null, blocks);
    } catch { return typstSchema.topNodeType.createAndFill()!; }
  }
</script>

<script lang="ts">
  import ProseEditorBase from './ProseEditorBase.svelte';

  import { getLocale } from './i18n/index';

  let { value = $bindable(''), placeholder = '', fillHeight = false, renderEndpoint = '/api/render/typst-snippet', locale = 'zh', onImageUpload }: {
    value: string; placeholder?: string; fillHeight?: boolean; renderEndpoint?: string; locale?: string;
    onImageUpload?: (file: File) => Promise<{ src: string; alt?: string }>;
  } = $props();

  let i = $derived(getLocale(locale));
  const mathNodeViews = createMathNodeViews(typstSchema, renderEndpoint, i.math.placeholder);
  const mathToolbar = createMathToolbarItems(typstSchema, i.toolbar);
</script>

<ProseEditorBase
  bind:value
  {placeholder}
  {fillHeight}
  schema={typstSchema}
  plugins={typstPlugins}
  nodeViews={mathNodeViews}
  serialize={serializeTypst}
  parse={parseTypst}
  headingPrefixes={['= ', '== ', '=== ']}
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

  /* ── Source mode (cursor inside) ── */
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
  /* $ delimiters shown as pseudo-elements, like heading prefixes */
  :global(.typst-math-inline-view.math-focused .math-source-text::before) { content: '$'; color: #888; user-select: none; }
  :global(.typst-math-inline-view.math-focused .math-source-text::after)  { content: '$'; color: #888; user-select: none; }
  :global(.typst-math-block-view.math-focused  .math-source-text::before) { content: '$ '; color: #888; user-select: none; }
  :global(.typst-math-block-view.math-focused  .math-source-text::after)  { content: ' $'; color: #888; user-select: none; }

  /* Source text styling */
  :global(.math-source-text) {
    font-family: var(--font-mono, monospace);
    font-size: 0.88em;
    color: #2a6b4a;
    white-space: pre-wrap;
  }

  /* ── Rendered mode ── */
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

  /* SVG sizing for MathML output */
  :global(.typst-math-inline-view svg),
  :global(.typst-math-block-view svg) { vertical-align: middle; max-width: 100%; height: auto; }

  /* Floating input for inline math editing */
  :global(.math-inline-input) {
    font-family: var(--font-mono, monospace) !important;
    font-size: 0.9em !important;
  }
</style>
