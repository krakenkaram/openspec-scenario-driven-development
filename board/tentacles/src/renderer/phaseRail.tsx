import { Box, Stack, UnstyledButton } from "@mantine/core";

export type Phase = "plan" | "build" | "release";

const PHASES: { id: Phase; label: string }[] = [
  { id: "plan", label: "PLAN" },
  { id: "build", label: "BUILD" },
  { id: "release", label: "RELEASE" },
];

export function PhaseRail({ active, onSelect }: { active: Phase; onSelect: (p: Phase) => void }) {
  return (
    <Box component="nav" className="ws-rail" aria-label="Phases">
      <Stack gap="sm" align="center" className="ws-rail-list">
        {PHASES.map((p) => (
          <UnstyledButton
            key={p.id}
            className={`phase-square${active === p.id ? " active" : ""}`}
            data-phase={p.id}
            aria-current={active === p.id || undefined}
            aria-label={p.label}
            title={p.label}
            onClick={() => onSelect(p.id)}
          >
            {p.label}
          </UnstyledButton>
        ))}
      </Stack>
    </Box>
  );
}
