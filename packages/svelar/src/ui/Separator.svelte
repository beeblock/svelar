<script lang="ts">
  interface Props {
    class?: string;
    [key: string]: any;
  }

  let { class: className = '', ...rest }: Props = $props();
</script>

<div class="shrink-0 bg-gray-200 h-px w-full {className}" {...rest} />
