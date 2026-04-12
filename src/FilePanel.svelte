<script lang="ts">
  export interface FileItem {
    path: string;
    is_dir: boolean;
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
    onReorder?: (paths: string[]) => Promise<void>;
  } = $props();

  let i = $derived(getLocale(locale));

  let showNewFile = $state(false);
  let newFileName = $state('');
  let creating = $state(false);

  // Drag state
  let dragIdx = $state<number | null>(null);
  let dropIdx = $state<number | null>(null);

  let visibleFiles = $derived(files.filter(f => !f.is_dir));

  function fileLabel(path: string) {
    return path.replace(/^.*\//, '');
  }

  async function doCreate() {
    let name = newFileName.trim();
    if (!name || creating) return;
    if (!name.includes('.')) name += defaultExt;
    creating = true;
    try {
      await onCreate(name);
      newFileName = '';
      showNewFile = false;
    } catch { /* */ }
    creating = false;
  }

  async function doDelete(path: string) {
    if (!onDelete || !confirm(i.file.deleteConfirm(fileLabel(path)))) return;
    try { await onDelete(path); } catch { /* */ }
  }

  function onDragStart(e: DragEvent, idx: number) {
    if (!sortable || !onReorder) return;
    dragIdx = idx;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
    }
  }

  function onDragOver(e: DragEvent, idx: number) {
    if (dragIdx === null) return;
    e.preventDefault();
    dropIdx = idx;
  }

  function onDragLeave() {
    dropIdx = null;
  }

  async function onDrop(e: DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx || !onReorder) {
      dragIdx = null;
      dropIdx = null;
      return;
    }
    const items = [...visibleFiles];
    const [moved] = items.splice(dragIdx, 1);
    items.splice(idx, 0, moved);
    dragIdx = null;
    dropIdx = null;
    try { await onReorder(items.map(f => f.path)); } catch { /* */ }
  }

  function onDragEnd() {
    dragIdx = null;
    dropIdx = null;
  }
</script>

<div class="fp">
  <div class="fp-list">
    {#each visibleFiles as f, i (f.path)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="fp-item"
        class:active={activeFile === f.path}
        class:drag-over={dropIdx === i && dragIdx !== i}
        class:dragging={dragIdx === i}
        onclick={() => onSelect(f.path)}
        draggable={sortable && !!onReorder}
        ondragstart={(e) => onDragStart(e, i)}
        ondragover={(e) => onDragOver(e, i)}
        ondragleave={onDragLeave}
        ondrop={(e) => onDrop(e, i)}
        ondragend={onDragEnd}
      >
        {#if sortable && onReorder}
          <span class="fp-grip">⠿</span>
        {/if}
        <span class="fp-name">{fileLabel(f.path)}</span>
        {#if onDelete}
          <button class="fp-delete" onclick={(e) => { e.stopPropagation(); doDelete(f.path); }} title={i.file.delete}>×</button>
        {/if}
      </div>
    {/each}
    {#if showNewFile}
      <div class="fp-new-row">
        <input
          type="text"
          bind:value={newFileName}
          placeholder="filename{defaultExt}"
          onkeydown={(e) => { if (e.key === 'Enter') doCreate(); if (e.key === 'Escape') { showNewFile = false; newFileName = ''; } }}
        />
      </div>
    {:else}
      <button class="fp-add" onclick={() => { showNewFile = true; }}>{i.file.newFile}</button>
    {/if}
  </div>
</div>

<style>
  .fp { padding: 8px 0; }
  .fp-item {
    padding: 6px 14px;
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
  .fp-item.drag-over { border-top: 2px solid var(--accent, #5f9b65); padding-top: 4px; }
  .fp-grip {
    cursor: grab; color: var(--text-hint, #ccc);
    font-size: 11px; margin-right: 6px; user-select: none;
    line-height: 1;
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
  .fp-new-row input {
    width: calc(100% - 28px); margin: 4px 14px;
    padding: 4px 8px; border: 1px solid var(--border, #ddd);
    border-radius: 4px; font-size: 12px;
  }
  .fp-add {
    display: block; width: calc(100% - 28px); margin: 4px 14px;
    padding: 4px; border: 1px dashed var(--border, #ccc);
    border-radius: 4px; background: none;
    font-size: 12px; color: var(--text-hint, #888);
    cursor: pointer; text-align: center;
  }
  .fp-add:hover { border-color: var(--accent, #5f9b65); color: var(--accent, #5f9b65); }
</style>
