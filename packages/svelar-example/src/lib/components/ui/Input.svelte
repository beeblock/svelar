<script lang="ts">
  interface Props {
    type?: string;
    value?: string;
    placeholder?: string;
    class?: string;
    disabled?: boolean;
    required?: boolean;
    name?: string;
    id?: string;
    oninput?: (e: Event) => void;
    [key: string]: any;
  }

  let {
    type = 'text',
    value = $bindable(''),
    placeholder = '',
    class: className = '',
    disabled = false,
    required = false,
    name,
    id,
    oninput,
    ...rest
  }: Props = $props();
</script>

<input
  {type}
  bind:value
  {placeholder}
  {disabled}
  {required}
  {name}
  {id}
  {oninput}
  class="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 {className}"
  {...rest}
/>
