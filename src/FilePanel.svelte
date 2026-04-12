<script lang="ts">
  export interface FileItem {
    path: string;
    is_dir: boolean;
  }

  let {
    files = [],
    activeFile = null,
    defaultExt = '.md',
    onSelect,
    onCreate,
    onDelete,
  }: {
    files: FileItem[];
    activeFile: string | null;
    defaultExt?: string;
    onSelect: (path: string) => void;
    onCreate: (path: string) => Promise<void>;
    onDelete?: (path: string) => Promise<void>;
  } = $props();

  let showNewFile = $state(false);
  let newFileName = $state('');
  let creating = $state(false);

  function fileLabel(path: string) {
    return path.replace(/^chapters\//, '');
  }

  async function doCreate() {
    let name = newFileName.trim();
    if (!name || creating) return;
    if (!name.includes('.')) name += defaultExt;
    const path = name.includes('/') ? name : `chapters/${name}`;
    creating = true;
    try {
      await onCreate(path);
      newFileName = '';
      showNewFile = false;
    } catch { /* */ }
    creating = false;
  }

  async function doDelete(path: string) {
    if (!onDelete || !confirm(`确定删除 ${fileLabel(path)}？`)) return;
    try { await onDelete(path); } catch { /* */ }
  }
</script>

<div class="fp">
  <div class="fp-list">
    {#each files.filter(f => !f.is_dir) as f (f.path)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="fp-item" class:active={activeFile === f.path} onclick={() => onSelect(f.path)}>
        <span class="fp-name">{fileLabel(f.path)}</span>
        {#if onDelete}
          <button class="fp-delete" onclick={(e) => { e.stopPropagation(); doDelete(f.path); }} title="删除">×</button>
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
      <button class="fp-add" onclick={() => { showNewFile = true; }}>+ 新文件</button>
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
  }
  .fp-item:hover { background: var(--bg-hover, #f0f0f0); }
  .fp-item.active { background: #e8f5e9; color: var(--text-primary, #333); font-weight: 500; }
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
