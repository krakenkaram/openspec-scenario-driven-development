import { Center, Stack, Text } from "@mantine/core";

export function PlanView() {
  return (
    <Stack data-testid="plan-phase" className="plan-phase" gap={0} style={{ flex: 1, minWidth: 0 }}>
      <Center p="xl" style={{ flex: 1 }}>
        <Text c="dimmed">Plan a change.</Text>
      </Center>
    </Stack>
  );
}
