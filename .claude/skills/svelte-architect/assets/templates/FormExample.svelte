<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import * as Card from "$lib/components/ui/card";
  import * as Select from "$lib/components/ui/select";

  interface User {
    name: string;
    email: string;
    role: string;
  }

  let name = $state<string>('');
  let email = $state<string>('');
  let role = $state<string>('');

  async function handleSubmit(): Promise<void> {
    const userData: User = { name, email, role };
    console.log('Submitting:', userData);

    // Add your submission logic here
  }
</script>

<Card.Root class="w-[400px]">
  <Card.Header>
    <Card.Title>Create Account</Card.Title>
    <Card.Description>Enter your information below</Card.Description>
  </Card.Header>
  <Card.Content class="space-y-4">
    <div class="space-y-2">
      <Label for="name">Name</Label>
      <Input
        id="name"
        type="text"
        bind:value={name}
        placeholder="John Doe"
      />
    </div>

    <div class="space-y-2">
      <Label for="email">Email</Label>
      <Input
        id="email"
        type="email"
        bind:value={email}
        placeholder="john@example.com"
      />
    </div>

    <div class="space-y-2">
      <Label for="role">Role</Label>
      <Select.Root bind:selected={role}>
        <Select.Trigger id="role">
          <Select.Value placeholder="Select a role" />
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="admin">Admin</Select.Item>
          <Select.Item value="user">User</Select.Item>
          <Select.Item value="guest">Guest</Select.Item>
        </Select.Content>
      </Select.Root>
    </div>
  </Card.Content>
  <Card.Footer>
    <Button onclick={handleSubmit} class="w-full">
      Create Account
    </Button>
  </Card.Footer>
</Card.Root>
