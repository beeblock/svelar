<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';

  type $$Props = NodeProps;

  export let data: $$Props['data'];
  export let selected: $$Props['selected'] = false;
</script>

<div class="custom-node" class:selected>
  <Handle type="target" position={Position.Top} />

  <div class="node-header">
    <strong>{data.label}</strong>
  </div>

  <div class="node-body">
    <p>{data.description || 'No description'}</p>
  </div>

  <Handle type="source" position={Position.Bottom} />
</div>

<style>
  .custom-node {
    padding: 12px;
    border-radius: 8px;
    background: white;
    border: 2px solid #e5e7eb;
    min-width: 180px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .custom-node.selected {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  .node-header {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 8px;
    color: #111827;
  }

  .node-body {
    font-size: 12px;
    color: #6b7280;
  }
</style>
