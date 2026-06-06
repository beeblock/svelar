<script lang="ts">
  import { writable } from 'svelte/store';
  import { SvelteFlow, Controls, Background, MiniMap, Panel } from '@xyflow/svelte';
  import { Button } from '$lib/components/ui/button';
  import type { Node, Edge } from '@xyflow/svelte';

  import '@xyflow/svelte/dist/style.css';

  import CustomNode from './CustomNode.svelte';

  const nodeTypes = {
    custom: CustomNode
  };

  const nodes = writable<Node[]>([
    {
      id: '1',
      type: 'input',
      data: { label: 'Start' },
      position: { x: 250, y: 0 }
    },
    {
      id: '2',
      type: 'custom',
      data: {
        label: 'Process',
        description: 'Custom node with description'
      },
      position: { x: 100, y: 100 }
    },
    {
      id: '3',
      type: 'output',
      data: { label: 'End' },
      position: { x: 250, y: 200 }
    }
  ]);

  const edges = writable<Edge[]>([
    { id: 'e1-2', source: '1', target: '2' },
    { id: 'e2-3', source: '2', target: '3', animated: true }
  ]);

  function addNode(): void {
    const newNode: Node = {
      id: `node-${Date.now()}`,
      type: 'custom',
      data: { label: 'New Node', description: 'Added dynamically' },
      position: { x: Math.random() * 400, y: Math.random() * 400 }
    };

    nodes.update((n) => [...n, newNode]);
  }
</script>

<div style="height: 600px;">
  <SvelteFlow {nodes} {edges} {nodeTypes} fitView>
    <Background />
    <Controls />
    <MiniMap />

    <Panel position="top-right">
      <Button onclick={addNode}>Add Node</Button>
    </Panel>
  </SvelteFlow>
</div>
