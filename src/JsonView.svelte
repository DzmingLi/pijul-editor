<script lang="ts">
  let { value = '' }: { value: string } = $props();

  let formatted = $derived((() => {
    try { return JSON.stringify(JSON.parse(value), null, 2); }
    catch { return value; }
  })());
</script>

<pre class="json-view">{formatted}</pre>

<style>
  .json-view {
    margin: 0;
    padding: 16px;
    font-size: 13px;
    font-family: var(--font-mono, monospace);
    line-height: 1.6;
    overflow: auto;
    flex: 1;
    background: var(--bg-white, #fafafa);
    color: var(--text-primary, #333);
    white-space: pre-wrap;
    word-break: break-all;
    user-select: text;
  }
</style>
