<script lang="ts">
  export interface DiffLine { type: 'add' | 'del' | 'same'; text: string }
  export interface VersionInfo { id: number; change_hash: string; message: string; created_at: string; unrecordable?: boolean }

  export interface VersionPanelLabels {
    diff: string;
    noChanges: string;
    history: string;
    noHistory: string;
    loading: string;
    recordPlaceholder: string;
    record: string;
  }

  const defaultLabels: VersionPanelLabels = {
    diff: 'Diff',
    noChanges: '无修改',
    history: '历史',
    noHistory: '暂无记录',
    loading: '...',
    recordPlaceholder: 'Record message...',
    record: 'Record',
  };

  let {
    currentDiffLines = [],
    versions = [],
    loadingHistory = false,
    recording = false,
    onRecord,
    onUnrecord,
    onFetchDiff,
    labels: userLabels = {},
  }: {
    currentDiffLines: DiffLine[];
    versions: VersionInfo[];
    loadingHistory?: boolean;
    recording?: boolean;
    onRecord: (message: string) => void;
    onUnrecord?: (v: VersionInfo) => void;
    onFetchDiff?: (v: VersionInfo) => Promise<DiffLine[]>;
    labels?: Partial<VersionPanelLabels>;
  } = $props();

  let labels = $derived({ ...defaultLabels, ...userLabels });

  let recordMessage = $state('');
  let addCount = $derived(currentDiffLines.filter(l => l.type === 'add').length);
  let delCount = $derived(currentDiffLines.filter(l => l.type === 'del').length);

  let selectedId = $state<number | null>(null);
  let selectedDiffLines = $state<DiffLine[]>([]);
  let loadingDiff = $state(false);

  async function selectVersion(v: VersionInfo) {
    console.log('[VP] selectVersion called', v);
    if (selectedId === v.id) {
      selectedId = null;
      selectedDiffLines = [];
      return;
    }
    selectedId = v.id;
    selectedDiffLines = [];
    console.log('[VP] onFetchDiff exists?', !!onFetchDiff);

    if (onFetchDiff) {
      loadingDiff = true;
      try {
        selectedDiffLines = await onFetchDiff(v);
      } catch { /* */ }
      loadingDiff = false;
    }
  }

  function doRecord() {
    onRecord(recordMessage.trim() || 'update');
    recordMessage = '';
  }

  function formatDate(s: string) {
    return s?.split('T')[0] || '';
  }
</script>

<div class="vp">
  <!-- Current diff -->
  <div class="vp-section">
    <div class="vp-header">
      <span>{labels.diff}</span>
      {#if addCount > 0 || delCount > 0}
        <span class="vp-stats">
          <span class="stat-add">+{addCount}</span>
          <span class="stat-del">-{delCount}</span>
        </span>
      {/if}
    </div>
    <div class="vp-diff-content">
      {#if currentDiffLines.filter(l => l.type !== 'same').length === 0}
        <p class="vp-empty">{labels.noChanges}</p>
      {:else}
        <pre class="vp-diff">{#each currentDiffLines.filter(l => l.type !== 'same') as line}{#if line.type === 'add'}<span class="line-add">+{line.text}</span>
{:else}<span class="line-del">-{line.text}</span>
{/if}{/each}</pre>
      {/if}
    </div>
  </div>

  <!-- Version history -->
  <div class="vp-section">
    <div class="vp-header">
      <span>{labels.history}</span>
      <span class="vp-count">{versions.length}</span>
    </div>
    <div class="vp-list">
      {#if loadingHistory}
        <p class="vp-empty">{labels.loading}</p>
      {:else if versions.length === 0}
        <p class="vp-empty">{labels.noHistory}</p>
      {:else}
        {#each versions as v (v.id)}
          <button
            class="vp-item"
            class:selected={selectedId === v.id}
            onclick={() => selectVersion(v)}
          >
            <span class="vp-msg">{v.message}</span>
            <span class="vp-meta">
              {formatDate(v.created_at)}
              <code>{v.change_hash.slice(0, 8)}</code>
            </span>
            {#if v.unrecordable && onUnrecord}
              <button class="vp-unrecord" onclick={(e) => { e.stopPropagation(); onUnrecord?.(v); }}>&times;</button>
            {/if}
          </button>
        {/each}
      {/if}
    </div>

    {#if loadingDiff}
      <p class="vp-empty">{labels.loading}</p>
    {:else if selectedDiffLines.length > 0}
      <div class="vp-version-diff">
        <pre class="vp-diff">{#each selectedDiffLines as line}{#if line.type === 'add'}<span class="line-add">+{line.text}</span>
{:else if line.type === 'del'}<span class="line-del">-{line.text}</span>
{:else}<span class="line-ctx"> {line.text}</span>
{/if}{/each}</pre>
      </div>
    {/if}
  </div>

  <!-- Record -->
  <div class="vp-record">
    <input
      class="vp-input"
      bind:value={recordMessage}
      placeholder={labels.recordPlaceholder}
      onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doRecord(); } }}
    />
    <button class="vp-btn" onclick={doRecord} disabled={recording}>
      {recording ? '...' : labels.record}
    </button>
  </div>
</div>

<style>
  .vp {
    display: flex;
    flex-direction: column;
    height: 100%;
    font-size: 12px;
  }
  .vp-section {
    border-bottom: 1px solid var(--border, #e5e5e5);
    overflow-y: auto;
  }
  .vp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    color: var(--text-hint, #999);
    background: var(--bg-hover, #f8f8f8);
    position: sticky;
    top: 0;
  }
  .vp-stats { display: flex; gap: 6px; }
  .stat-add { color: #1a7f37; }
  .stat-del { color: #cf222e; }
  .vp-count {
    font-size: 10px;
    background: var(--bg-gray, #eee);
    padding: 1px 5px;
    border-radius: 8px;
  }
  .vp-diff-content {
    max-height: 200px;
    overflow-y: auto;
  }
  .vp-empty {
    padding: 12px;
    color: var(--text-hint, #999);
    text-align: center;
  }
  .vp-diff {
    margin: 0;
    padding: 6px 12px;
    font-size: 11px;
    font-family: var(--font-mono, monospace);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .line-add { color: #1a7f37; display: block; background: #dafbe1; }
  .line-del { color: #cf222e; display: block; background: #ffebe9; }
  .line-ctx { color: var(--text-hint, #999); display: block; }

  .vp-list {
    max-height: 300px;
    overflow-y: auto;
  }
  .vp-item {
    display: block;
    width: 100%;
    padding: 6px 12px;
    border: none;
    border-bottom: 1px solid var(--border, #eee);
    background: none;
    text-align: left;
    cursor: pointer;
    position: relative;
  }
  .vp-item:hover { background: var(--bg-hover, #f5f5f5); }
  .vp-item.selected { background: #e8f5e9; }
  .vp-msg { display: block; font-size: 12px; color: var(--text-primary, #333); }
  .vp-meta { display: block; font-size: 10px; color: var(--text-hint, #999); margin-top: 2px; }
  .vp-meta code { font-size: 10px; }
  .vp-unrecord {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: var(--text-hint, #999);
    cursor: pointer;
    font-size: 14px;
  }
  .vp-unrecord:hover { color: #cf222e; }

  .vp-version-diff {
    max-height: 200px;
    overflow-y: auto;
    border-top: 1px solid var(--border, #eee);
  }

  .vp-record {
    display: flex;
    gap: 4px;
    padding: 8px;
    border-top: 1px solid var(--border, #e5e5e5);
    margin-top: auto;
  }
  .vp-input {
    flex: 1;
    padding: 5px 8px;
    border: 1px solid var(--border, #ddd);
    border-radius: 4px;
    font-size: 12px;
  }
  .vp-btn {
    padding: 5px 14px;
    border: 1px solid var(--accent, #5f9b65);
    border-radius: 4px;
    background: var(--accent, #5f9b65);
    color: white;
    font-size: 12px;
    cursor: pointer;
  }
  .vp-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
