# SvelteFlow Guide

**Official Site:** https://svelteflow.dev/

SvelteFlow is a highly customizable library for building node-based editors, flow charts, diagrams, and workflows.

## Installation

```bash
npm install @xyflow/svelte
```

## Basic Setup

```svelte
<script lang="ts">
  import { writable } from 'svelte/store';
  import { SvelteFlow, Controls, Background, MiniMap } from '@xyflow/svelte';
  import type { Node, Edge } from '@xyflow/svelte';

  // Import styles
  import '@xyflow/svelte/dist/style.css';

  const nodes = writable<Node[]>([
    {
      id: '1',
      type: 'input',
      data: { label: 'Input Node' },
      position: { x: 250, y: 5 }
    },
    {
      id: '2',
      data: { label: 'Default Node' },
      position: { x: 100, y: 100 }
    },
    {
      id: '3',
      type: 'output',
      data: { label: 'Output Node' },
      position: { x: 250, y: 200 }
    }
  ]);

  const edges = writable<Edge[]>([
    { id: 'e1-2', source: '1', target: '2' },
    { id: 'e2-3', source: '2', target: '3', animated: true }
  ]);
</script>

<div style="height: 500px;">
  <SvelteFlow {nodes} {edges}>
    <Background />
    <Controls />
    <MiniMap />
  </SvelteFlow>
</div>
```

## Node Types

### Built-in Node Types

```typescript
type NodeType = 'default' | 'input' | 'output';

const nodes = writable<Node[]>([
  {
    id: '1',
    type: 'input',      // Source node
    data: { label: 'Start' },
    position: { x: 0, y: 0 }
  },
  {
    id: '2',
    type: 'default',    // Standard node
    data: { label: 'Process' },
    position: { x: 0, y: 100 }
  },
  {
    id: '3',
    type: 'output',     // Terminal node
    data: { label: 'End' },
    position: { x: 0, y: 200 }
  }
]);
```

### Custom Node Types

```svelte
<!-- CustomNode.svelte -->
<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';

  type $$Props = NodeProps;

  export let data: $$Props['data'];
  export let selected: $$Props['selected'] = false;
</script>

<div class="custom-node" class:selected>
  <Handle type="target" position={Position.Top} />

  <div class="node-content">
    <strong>{data.label}</strong>
    <p>{data.description}</p>
  </div>

  <Handle type="source" position={Position.Bottom} />
</div>

<style>
  .custom-node {
    padding: 10px;
    border-radius: 5px;
    background: white;
    border: 2px solid #ddd;
    min-width: 150px;
  }

  .custom-node.selected {
    border-color: #0066ff;
  }

  .node-content {
    text-align: center;
  }
</style>
```

```svelte
<!-- Usage -->
<script lang="ts">
  import { SvelteFlow } from '@xyflow/svelte';
  import CustomNode from './CustomNode.svelte';
  import type { Node } from '@xyflow/svelte';

  const nodeTypes = {
    custom: CustomNode
  };

  const nodes = writable<Node[]>([
    {
      id: '1',
      type: 'custom',
      data: {
        label: 'Custom Node',
        description: 'This is a custom node'
      },
      position: { x: 100, y: 100 }
    }
  ]);
</script>

<SvelteFlow {nodes} {nodeTypes}>
  <Background />
  <Controls />
</SvelteFlow>
```

## Edges

### Edge Types

```typescript
const edges = writable<Edge[]>([
  {
    id: 'e1-2',
    source: '1',
    target: '2',
    type: 'default'     // default, step, smoothstep, straight
  },
  {
    id: 'e2-3',
    source: '2',
    target: '3',
    type: 'smoothstep',
    animated: true,      // Animated edge
    label: 'Success'     // Edge label
  },
  {
    id: 'e3-4',
    source: '3',
    target: '4',
    type: 'step',
    style: 'stroke: red; stroke-width: 2;'  // Custom style
  }
]);
```

### Custom Edges

```svelte
<!-- CustomEdge.svelte -->
<script lang="ts">
  import { getBezierPath } from '@xyflow/svelte';
  import type { EdgeProps } from '@xyflow/svelte';

  type $$Props = EdgeProps;

  export let id: $$Props['id'];
  export let sourceX: $$Props['sourceX'];
  export let sourceY: $$Props['sourceY'];
  export let targetX: $$Props['targetX'];
  export let targetY: $$Props['targetY'];
  export let sourcePosition: $$Props['sourcePosition'];
  export let targetPosition: $$Props['targetPosition'];
  export let data: $$Props['data'];

  $: [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  });
</script>

<g>
  <path
    {id}
    class="svelte-flow__edge-path"
    d={edgePath}
    stroke={data.color || '#b1b1b7'}
    stroke-width="2"
  />
  <text>
    <textPath
      href="#{id}"
      style="font-size: 12px"
      startOffset="50%"
      text-anchor="middle"
    >
      {data.label || ''}
    </textPath>
  </text>
</g>
```

## Interactive Features

### Drag & Drop Nodes

```svelte
<script lang="ts">
  import { SvelteFlow, useNodesData, useHandleConnections } from '@xyflow/svelte';
  import type { Node } from '@xyflow/svelte';

  let nodes = $state<Node[]>([]);

  function onDrop(event: DragEvent) {
    event.preventDefault();

    const type = event.dataTransfer?.getData('application/svelteflow');
    const position = {
      x: event.clientX,
      y: event.clientY
    };

    const newNode: Node = {
      id: `${Date.now()}`,
      type,
      position,
      data: { label: `${type} node` }
    };

    nodes = [...nodes, newNode];
  }
</script>

<div
  ondrop={onDrop}
  ondragover={(e) => e.preventDefault()}
  style="height: 500px;"
>
  <SvelteFlow bind:nodes>
    <Background />
    <Controls />
  </SvelteFlow>
</div>
```

### Event Handlers

```svelte
<script lang="ts">
  import { SvelteFlow } from '@xyflow/svelte';
  import type { Node, Edge, Connection } from '@xyflow/svelte';

  let nodes = $state<Node[]>([]);
  let edges = $state<Edge[]>([]);

  function onNodeClick(event: CustomEvent<{ node: Node }>) {
    console.log('Node clicked:', event.detail.node);
  }

  function onConnect(event: CustomEvent<Connection>) {
    const connection = event.detail;
    const newEdge: Edge = {
      id: `e${connection.source}-${connection.target}`,
      source: connection.source,
      target: connection.target
    };
    edges = [...edges, newEdge];
  }

  function onNodeDragStop(event: CustomEvent<{ node: Node }>) {
    console.log('Node dragged:', event.detail.node);
  }
</script>

<SvelteFlow
  {nodes}
  {edges}
  on:nodeclick={onNodeClick}
  on:connect={onConnect}
  on:nodedragstop={onNodeDragStop}
>
  <Background />
  <Controls />
</SvelteFlow>
```

## Advanced Patterns

### Workflow Builder

```svelte
<script lang="ts">
  import { writable } from 'svelte/store';
  import { SvelteFlow, Controls, Background, Panel } from '@xyflow/svelte';
  import { Button } from '$lib/components/ui/button';
  import type { Node, Edge } from '@xyflow/svelte';

  import ActionNode from './nodes/ActionNode.svelte';
  import ConditionNode from './nodes/ConditionNode.svelte';
  import TriggerNode from './nodes/TriggerNode.svelte';

  const nodeTypes = {
    action: ActionNode,
    condition: ConditionNode,
    trigger: TriggerNode
  };

  let nodes = $state<Node[]>([]);
  let edges = $state<Edge[]>([]);

  function addNode(type: string) {
    const newNode: Node = {
      id: `${Date.now()}`,
      type,
      data: { label: `New ${type}` },
      position: { x: Math.random() * 400, y: Math.random() * 400 }
    };
    nodes = [...nodes, newNode];
  }

  function saveWorkflow() {
    const workflow = { nodes, edges };
    console.log('Saving workflow:', workflow);
  }
</script>

<div style="height: 600px;">
  <SvelteFlow {nodes} {edges} {nodeTypes}>
    <Background />
    <Controls />

    <Panel position="top-right" class="space-x-2">
      <Button onclick={() => addNode('trigger')}>Add Trigger</Button>
      <Button onclick={() => addNode('action')}>Add Action</Button>
      <Button onclick={() => addNode('condition')}>Add Condition</Button>
      <Button onclick={saveWorkflow} variant="outline">Save</Button>
    </Panel>
  </SvelteFlow>
</div>
```

### Nested Flows (Subflows)

```svelte
<script lang="ts">
  import { SvelteFlow } from '@xyflow/svelte';
  import type { Node } from '@xyflow/svelte';

  let nodes = $state<Node[]>([
    {
      id: 'group-1',
      type: 'group',
      position: { x: 0, y: 0 },
      style: {
        width: 400,
        height: 300,
        backgroundColor: 'rgba(240, 240, 240, 0.5)'
      },
      data: { label: 'Subflow 1' }
    },
    {
      id: 'child-1',
      position: { x: 50, y: 50 },
      data: { label: 'Child Node 1' },
      parentNode: 'group-1',
      extent: 'parent'  // Constrain to parent
    },
    {
      id: 'child-2',
      position: { x: 50, y: 150 },
      data: { label: 'Child Node 2' },
      parentNode: 'group-1',
      extent: 'parent'
    }
  ]);
</script>

<SvelteFlow {nodes}>
  <Background />
  <Controls />
</SvelteFlow>
```

## Styling

```svelte
<script lang="ts">
  import { SvelteFlow } from '@xyflow/svelte';
  import type { Node } from '@xyflow/svelte';

  let nodes = $state<Node[]>([
    {
      id: '1',
      data: { label: 'Styled Node' },
      position: { x: 100, y: 100 },
      style: {
        background: '#D6D5E6',
        color: '#333',
        border: '1px solid #222138',
        borderRadius: '8px',
        padding: '10px'
      }
    }
  ]);
</script>

<SvelteFlow {nodes} />

<style>
  :global(.svelte-flow) {
    background-color: #f8f9fa;
  }

  :global(.svelte-flow__node) {
    font-family: 'Inter', sans-serif;
  }

  :global(.svelte-flow__edge-path) {
    stroke-width: 2;
  }
</style>
```

## Best Practices

1. **Always use TypeScript** - Import and use proper types from `@xyflow/svelte`
2. **Use stores for state** - Use Svelte stores (`writable`) for nodes and edges
3. **Custom nodes for complex UI** - Create custom nodes for anything beyond simple labels
4. **Handle events** - Use event handlers for interactivity
5. **Panel for controls** - Use Panel component for toolbars and action buttons
6. **Accessibility** - Add proper ARIA labels and keyboard navigation
7. **Performance** - Use `onlyRenderVisibleElements` for large flows
8. **Save/Load** - Implement save/load functionality for workflows

## Common Use Cases

- **Workflow Builders** - Automation, business processes
- **Data Pipelines** - ETL, data transformation flows
- **State Machines** - Application state diagrams
- **Mind Maps** - Brainstorming, planning
- **Organization Charts** - Company structures
- **Network Diagrams** - System architecture
- **Decision Trees** - Logic flows, decision making
