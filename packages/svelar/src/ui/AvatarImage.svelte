<script lang="ts">
  interface Props {
    src?: string;
    alt?: string;
    class?: string;
    [key: string]: any;
  }

  let { src = '', alt = '', class: className = '', ...rest }: Props = $props();
</script>

<img {src} {alt} class="aspect-square h-full w-full object-cover {className}" {...rest} />
