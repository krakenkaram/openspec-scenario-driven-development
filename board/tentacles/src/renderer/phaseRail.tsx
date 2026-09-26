import { Box, Stack, Tooltip, UnstyledButton } from "@mantine/core";

export type Phase = "plan" | "build" | "release";

const PHASES: { id: Phase; label: string; emoji: string }[] = [
  { id: "plan", label: "PLAN", emoji: "💡" },
  { id: "build", label: "BUILD", emoji: "🛠️" },
  { id: "release", label: "RELEASE", emoji: "🚀" },
];

export function PhaseRail({ active, onSelect }: { active: Phase; onSelect: (p: Phase) => void }) {
  return (
    <Box component="nav" className="ws-rail" aria-label="Phases">
      <Stack gap="sm" align="center" className="ws-rail-list">
        {PHASES.map((p) => (
          <Tooltip key={p.id} label={p.label} position="right" withArrow openDelay={0} transitionProps={{ duration: 0 }}>
            <UnstyledButton
              className={`phase-square${active === p.id ? " active" : ""}`}
              data-phase={p.id}
              aria-current={active === p.id || undefined}
              aria-label={p.label}
              onClick={() => onSelect(p.id)}
            >
              <span aria-hidden className="phase-emoji">
                {p.emoji}
              </span>
            </UnstyledButton>
          </Tooltip>
        ))}
      </Stack>
    </Box>
  );
}
