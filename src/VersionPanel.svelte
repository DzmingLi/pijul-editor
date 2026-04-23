<script module lang="ts">
  export interface DiffLine { type: 'add' | 'del' | 'same'; text: string }
  export interface VersionInfo { id: number; change_hash: string; message: string; author?: string; created_at: string; unrecordable?: boolean }

  export interface VersionPanelLabels {
    diff: string;
    noChanges: string;
    history: string;
    noHistory: string;
    loading: string;
    recordPlaceholder: string;
    record: string;
  }
</script>

<script lang="ts" generics="V extends VersionInfo">
  import { getLocale } from './i18n/index';

  // Generic `V extends VersionInfo` so consumers can pass richer version
  // rows (e.g. NightBoat's `ArticleVersionInfo` with `article_uri` /
  // `editor_did`) and still receive the full shape in their callbacks —
  // TypeScript's contravariance would otherwise reject the richer callback.
  let {
    versions = [],
    loadingHistory = false,
    recording = false,
    locale = 'zh',
    onRecord,
    onUnrecord,
    onFetchDiff,
    labels: userLabels = {},
  }: {
    versions: V[];
    loadingHistory?: boolean;
    recording?: boolean;
    locale?: string;
    onRecord: (message: string) => Promise<V | void>;
    onUnrecord?: (v: V) => void;
    onFetchDiff?: (v: V) => Promise<DiffLine[]>;
    labels?: Partial<VersionPanelLabels>;
  } = $props();

  let i = $derived(getLocale(locale));
  let labels = $derived({ ...i.version, ...userLabels });

  let recordMessage = $state('');

  let selectedId = $state<number | null>(null);
  let selectedVersion = $derived(versions.find(v => v.id === selectedId) ?? null);
  let selectedDiffLines = $state<DiffLine[]>([]);
  let loadingDiff = $state(false);
  let diffError = $state('');

  async function selectVersion(v: V) {
    if (selectedId === v.id) {
      selectedId = null;
      selectedDiffLines = [];
      diffError = '';
      return;
    }
    selectedId = v.id;
    selectedDiffLines = [];
    diffError = '';

    if (onFetchDiff) {
      loadingDiff = true;
      try {
        selectedDiffLines = await onFetchDiff(v);
      } catch (e: any) {
        console.error('[VersionPanel] onFetchDiff error:', e);
        diffError = e?.message || i.version.loadFailed;
      }
      loadingDiff = false;
    }
  }

  async function doRecord() {
    const msg = recordMessage.trim() || 'update';
    recordMessage = '';
    const newVersion = await onRecord(msg);
    // Auto-expand the new change's diff
    if (newVersion && onFetchDiff) {
      await selectVersion(newVersion);
    }
  }

  function formatDate(s: string) {
    return s?.split('T')[0] || '';
  }
</script>

<div class="vp">
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
              {#if v.author}<span class="vp-author">{v.author}</span>{/if}
              <code>{v.change_hash.slice(0, 8)}</code>
            </span>
            {#if v.unrecordable && onUnrecord}
              <button class="vp-unrecord" onclick={(e) => { e.stopPropagation(); onUnrecord?.(v); }}>&times;</button>
            {/if}
          </button>
        {/each}
      {/if}
    </div>

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

{#if selectedId !== null}
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="diff-overlay" onclick={() => { selectedId = null; selectedDiffLines = []; diffError = ''; }}>
  <div class="diff-modal" onclick={(e) => e.stopPropagation()}>
    <div class="diff-modal-header">
      <span>{i.version.changeDetails}</span>
      <span class="diff-modal-hash"><code>{selectedVersion?.change_hash.slice(0, 12)}</code></span>
      <button class="diff-modal-close" onclick={() => { selectedId = null; selectedDiffLines = []; diffError = ''; }}>×</button>
    </div>
    <div class="diff-modal-body">
      {#if loadingDiff}
        <p class="vp-empty">{labels.loading}</p>
      {:else if diffError}
        <p class="vp-empty vp-error">{diffError}</p>
      {:else if selectedDiffLines.length > 0}
        {#each selectedDiffLines as line}
          {#if line.type === 'add'}
            <div class="diff-line diff-add"><code>+{line.text}</code></div>
          {:else if line.type === 'del'}
            <div class="diff-line diff-del"><code>-{line.text}</code></div>
          {:else}
            <div class="diff-line diff-ctx"><code> {line.text}</code></div>
          {/if}
        {/each}
      {:else}
        <p class="vp-empty">{i.version.noContentLines}</p>
      {/if}
    </div>
  </div>
</div>
{/if}

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
  .vp-count {
    font-size: 10px;
    background: var(--bg-gray, #eee);
    padding: 1px 5px;
    border-radius: 8px;
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
  .vp-author { font-weight: 500; color: var(--text-secondary, #666); margin-right: 4px; }
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

  .vp-error { color: #cf222e; }

  /* Diff modal overlay */
  .diff-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .diff-modal {
    background: var(--bg-white, #fff);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    width: min(720px, 90vw);
    max-height: 80vh;
    display: flex;
    flex-direction: column;
  }
  .diff-modal-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border, #e5e5e5);
    font-size: 13px;
    font-weight: 600;
  }
  .diff-modal-hash { color: var(--text-hint, #999); font-size: 11px; }
  .diff-modal-close {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--text-hint, #999);
    cursor: pointer;
    font-size: 18px;
    padding: 0 4px;
    line-height: 1;
  }
  .diff-modal-close:hover { color: #cf222e; }
  .diff-modal-body {
    overflow-y: auto;
    padding: 8px 0;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    line-height: 1.6;
  }
  .diff-line { padding: 0 16px; }
  .diff-line code { white-space: pre-wrap; word-break: break-all; }
  .diff-add { color: #155724; background: #d4edda; }
  .diff-del { color: #721c24; background: #f8d7da; }
  .diff-ctx { color: var(--text-hint, #999); }

  .vp-record {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    border-top: 1px solid var(--border, #e5e5e5);
    margin-top: auto;
  }
  .vp-input {
    width: 100%;
    padding: 5px 8px;
    border: 1px solid var(--border, #ddd);
    border-radius: 4px;
    font-size: 12px;
    box-sizing: border-box;
  }
  .vp-btn {
    width: 100%;
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
