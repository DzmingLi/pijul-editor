<script lang="ts">
  export interface FileItem {
    path: string;
    is_dir: boolean;
  }

  interface TreeNode {
    name: string;
    path: string;
    is_dir: boolean;
    children: TreeNode[];
  }

  import { getLocale } from './i18n/index';

  let {
    files = [],
    activeFile = null,
    defaultExt = '.md',
    sortable = false,
    locale = 'zh',
    onSelect,
    onCreate,
    onDelete,
    onReorder,
  }: {
    files: FileItem[];
    activeFile: string | null;
    defaultExt?: string;
    sortable?: boolean;
    locale?: string;
    onSelect: (path: string) => void;
    onCreate: (path: string) => Promise<void>;
    onDelete?: (path: string) => Promise<void>;
    onReorder?: (parentDir: string, paths: string[]) => Promise<void>;
  } = $props();

  let i = $derived(getLocale(locale));

  // null = not creating; '' = root; 'some/dir' = under that dir
  let newFileDir = $state<string | null>(null);
  let newFileName = $state('');
  let creating = $state(false);

  let collapsed = $state<Set<string>>(new Set());

  // Drag-reorder state (within same parent)
  let dragParent = $state<string | null>(null);
  let dragIdx = $state<number | null>(null);
  let dropIdx = $state<number | null>(null);

  function onDragStart(e: DragEvent, parent: string, idx: number) {
    if (!sortable || !onReorder) return;
    dragParent = parent;
    dragIdx = idx;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
    }
  }

  function onDragOver(e: DragEvent, parent: string, idx: number) {
    if (dragIdx === null || dragParent !== parent) return;
    e.preventDefault();
    dropIdx = idx;
  }

  function onDragLeave() { dropIdx = null; }

  async function onDrop(e: DragEvent, parent: string, idx: number, siblings: TreeNode[]) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx || dragParent !== parent || !onReorder) {
      dragIdx = null; dropIdx = null; dragParent = null;
      return;
    }
    const fileNodes = siblings.filter(n => !n.is_dir);
    const items = [...fileNodes];
    const [moved] = items.splice(dragIdx, 1);
    items.splice(idx, 0, moved);
    dragIdx = null; dropIdx = null; dragParent = null;
    try { await onReorder(parent, items.map(f => f.path)); } catch { /* */ }
  }

  function onDragEnd() { dragIdx = null; dropIdx = null; dragParent = null; }

  function toggleDir(path: string) {
    const next = new Set(collapsed);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    collapsed = next;
  }

  function startCreate(dirPath: string) {
    newFileDir = dirPath;
    newFileName = '';
    // auto-expand the target directory
    if (dirPath && collapsed.has(dirPath)) {
      toggleDir(dirPath);
    }
  }

  function cancelCreate() {
    newFileDir = null;
    newFileName = '';
  }

  async function doCreate() {
    let name = newFileName.trim();
    if (!name || creating) return;
    if (!name.includes('.')) name += defaultExt;
    const fullPath = newFileDir ? newFileDir + '/' + name : name;
    creating = true;
    try {
      await onCreate(fullPath);
      cancelCreate();
    } catch { /* */ }
    creating = false;
  }

  async function doDelete(path: string) {
    const label = path.replace(/^.*\//, '');
    if (!onDelete || !confirm(i.file.deleteConfirm(label))) return;
    try { await onDelete(path); } catch { /* */ }
  }

  function buildTree(items: FileItem[]): TreeNode[] {
    const root: TreeNode[] = [];
    const dirMap = new Map<string, TreeNode>();

    function ensureDir(dirPath: string): TreeNode {
      if (dirMap.has(dirPath)) return dirMap.get(dirPath)!;
      const parts = dirPath.split('/');
      const name = parts[parts.length - 1];
      const node: TreeNode = { name, path: dirPath, is_dir: true, children: [] };
      dirMap.set(dirPath, node);

      if (parts.length > 1) {
        const parentPath = parts.slice(0, -1).join('/');
        const parent = ensureDir(parentPath);
        if (!parent.children.some(c => c.path === dirPath)) {
          parent.children.push(node);
        }
      } else {
        if (!root.some(c => c.path === dirPath)) {
          root.push(node);
        }
      }
      return node;
    }

    for (const f of items) {
      const parts = f.path.split('/');
      if (parts.length === 1) {
        root.push({ name: parts[0], path: f.path, is_dir: f.is_dir, children: [] });
      } else {
        const parentPath = parts.slice(0, -1).join('/');
        const parent = ensureDir(parentPath);
        const name = parts[parts.length - 1];
        if (!f.is_dir) {
          parent.children.push({ name, path: f.path, is_dir: false, children: [] });
        } else {
          ensureDir(f.path);
        }
      }
    }

    function sortNodes(nodes: TreeNode[]) {
      // Always put directories before files
      const dirs = nodes.filter(n => n.is_dir);
      const files = nodes.filter(n => !n.is_dir);
      dirs.sort((a, b) => a.name.localeCompare(b.name));
      if (!sortable) files.sort((a, b) => a.name.localeCompare(b.name));
      nodes.length = 0;
      nodes.push(...dirs, ...files);
      for (const n of dirs) {
        if (n.children.length) sortNodes(n.children);
      }
    }
    sortNodes(root);
    return root;
  }

  let tree = $derived(buildTree(files));

  function isAncestorOfActive(dirPath: string): boolean {
    if (!activeFile) return false;
    return activeFile.startsWith(dirPath + '/');
  }
</script>

{#snippet newFileInput(depth: number)}
  <div class="fp-new-row" style="padding-left: {12 + depth * 16}px">
    <input
      type="text"
      bind:value={newFileName}
      placeholder="filename{defaultExt}"
      onkeydown={(e) => { if (e.key === 'Enter') doCreate(); if (e.key === 'Escape') cancelCreate(); }}
    />
    <button class="fp-new-cancel" onclick={cancelCreate}>×</button>
  </div>
{/snippet}

{#snippet treeNodes(nodes: TreeNode[], depth: number, parentDir: string)}
  {@const fileNodes = nodes.filter(n => !n.is_dir)}
  {#each nodes as node (node.path)}
    {#if node.is_dir}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="fp-dir"
        class:has-active={isAncestorOfActive(node.path)}
        style="padding-left: {12 + depth * 16}px"
        onclick={() => toggleDir(node.path)}
      >
        <span class="fp-arrow" class:open={!collapsed.has(node.path)}>▶</span>
        <span class="fp-dir-name">{node.name}</span>
        <button
          class="fp-dir-add"
          onclick={(e) => { e.stopPropagation(); startCreate(node.path); }}
          title={i.file.newFile}
        >+</button>
      </div>
      {#if !collapsed.has(node.path)}
        {@render treeNodes(node.children, depth + 1, node.path)}
        {#if newFileDir === node.path}
          {@render newFileInput(depth + 1)}
        {/if}
      {/if}
    {:else}
      {@const fileIdx = fileNodes.indexOf(node)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="fp-item"
        class:active={activeFile === node.path}
        class:dragging={sortable && dragParent === parentDir && dragIdx === fileIdx}
        class:drag-over={sortable && dragParent === parentDir && dropIdx === fileIdx && dragIdx !== fileIdx}
        style="padding-left: {12 + depth * 16}px"
        onclick={() => onSelect(node.path)}
        draggable={sortable && !!onReorder}
        ondragstart={(e) => onDragStart(e, parentDir, fileIdx)}
        ondragover={(e) => onDragOver(e, parentDir, fileIdx)}
        ondragleave={onDragLeave}
        ondrop={(e) => onDrop(e, parentDir, fileIdx, nodes)}
        ondragend={onDragEnd}
      >
        {#if sortable && onReorder}
          <span class="fp-grip">⠿</span>
        {/if}
        <span class="fp-name">{node.name}</span>
        {#if onDelete}
          <button class="fp-delete" onclick={(e) => { e.stopPropagation(); doDelete(node.path); }} title={i.file.delete}>×</button>
        {/if}
      </div>
    {/if}
  {/each}
{/snippet}

<div class="fp">
  <div class="fp-list">
    {@render treeNodes(tree, 0, '')}
    {#if newFileDir === ''}
      {@render newFileInput(0)}
    {/if}
    <button class="fp-add" onclick={() => startCreate('')}>{i.file.newFile}</button>
  </div>
</div>

<style>
  .fp { padding: 8px 0; }

  .fp-dir {
    padding: 5px 14px;
    font-size: 13px;
    cursor: pointer;
    color: var(--text-secondary, #555);
    display: flex;
    align-items: center;
    gap: 4px;
    user-select: none;
  }
  .fp-dir:hover { background: var(--bg-hover, #f0f0f0); }
  .fp-dir.has-active { color: var(--text-primary, #333); }

  .fp-arrow {
    display: inline-block;
    font-size: 9px;
    transition: transform 0.15s;
    width: 12px;
    text-align: center;
    flex-shrink: 0;
  }
  .fp-arrow.open { transform: rotate(90deg); }

  .fp-dir-name {
    flex: 1;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fp-dir-add {
    background: none; border: none;
    color: transparent;
    cursor: pointer;
    font-size: 15px; font-weight: 500;
    padding: 0 4px;
    line-height: 1;
    flex-shrink: 0;
  }
  .fp-dir:hover .fp-dir-add { color: var(--text-hint, #aaa); }
  .fp-dir-add:hover { color: var(--accent, #5f9b65) !important; }

  .fp-item {
    padding: 5px 14px;
    font-size: 13px;
    cursor: pointer;
    color: var(--text-secondary, #555);
    display: flex;
    align-items: center;
    justify-content: space-between;
    transition: background 0.1s;
  }
  .fp-item:hover { background: var(--bg-hover, #f0f0f0); }
  .fp-item.active { background: #e8f5e9; color: var(--text-primary, #333); font-weight: 500; }
  .fp-item.dragging { opacity: 0.4; }
  .fp-item.drag-over { border-top: 2px solid var(--accent, #5f9b65); padding-top: 3px; }

  .fp-grip {
    cursor: grab; color: var(--text-hint, #ccc);
    font-size: 11px; margin-right: 6px; user-select: none;
    line-height: 1; flex-shrink: 0;
  }
  .fp-grip:active { cursor: grabbing; }

  .fp-name {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .fp-delete {
    background: none; border: none; color: transparent;
    cursor: pointer; font-size: 14px; padding: 0 2px; line-height: 1;
  }
  .fp-item:hover .fp-delete { color: var(--text-hint, #ccc); }
  .fp-delete:hover { color: #cf222e !important; }

  .fp-new-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-right: 14px;
  }
  .fp-new-row input {
    flex: 1;
    margin: 4px 0;
    padding: 4px 8px;
    border: 1px solid var(--accent, #5f9b65);
    border-radius: 4px;
    font-size: 12px;
    outline: none;
  }
  .fp-new-cancel {
    background: none; border: none;
    color: var(--text-hint, #aaa);
    cursor: pointer; font-size: 14px;
    padding: 0 2px; line-height: 1;
  }
  .fp-new-cancel:hover { color: var(--text-secondary, #555); }

  .fp-add {
    display: block; width: calc(100% - 28px); margin: 4px 14px;
    padding: 4px; border: 1px dashed var(--border, #ccc);
    border-radius: 4px; background: none;
    font-size: 12px; color: var(--text-hint, #888);
    cursor: pointer; text-align: center;
  }
  .fp-add:hover { border-color: var(--accent, #5f9b65); color: var(--accent, #5f9b65); }
</style>
