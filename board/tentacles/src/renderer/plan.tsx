import { useEffect, useState } from "react";
import { Box, Button, Group, ScrollArea, Stack, Text, Textarea } from "@mantine/core";
import type { PlanTurn } from "../shared/ipc-contract";

function KiroEngineBadge() {
  return (
    <Group gap={6} data-testid="kiro-engine" aria-label="Engine: kiro" className="kiro-engine" wrap="nowrap">
      <Box component="span" aria-hidden className="kiro-mark">
        ◆
      </Box>
      <Text size="xs" c="dimmed">
        Powered by kiro
      </Text>
    </Group>
  );
}

const SPEAKER_LABEL: Record<PlanTurn["speaker"], string> = {
  BA: "BA",
  Dev: "Dev",
  QA: "QA",
  system: "System",
  error: "Error",
  user: "You",
};

function ChatTurn({ turn }: { turn: PlanTurn }) {
  return (
    <Box data-testid="chat-turn" data-speaker={turn.speaker} className={`chat-turn speaker-${turn.speaker}`}>
      <Text size="xs" fw={700} className="turn-speaker">
        {SPEAKER_LABEL[turn.speaker]}
      </Text>
      <Text size="sm">{turn.text}</Text>
    </Box>
  );
}

export function PlanView() {
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [idea, setIdea] = useState("");
  const [turns, setTurns] = useState<PlanTurn[]>([]);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    return window.electronAPI.onPlanTurn((turn) => {
      setTurns((t) => [...t, turn]);
    });
  }, []);

  const browse = async () => {
    const res = await window.electronAPI.chooseDirectory();
    if (res.path) setFolderPath(res.path);
  };

  const send = async () => {
    const text = idea.trim();
    if (!text) return;
    if (!started) {
      if (!folderPath) return;
      setTurns((t) => [...t, { speaker: "user", text }]);
      setIdea("");
      setStarted(true);
      await window.electronAPI.startPlanSession({ folderPath, idea: text });
    } else {
      setTurns((t) => [...t, { speaker: "user", text }]);
      setIdea("");
      await window.electronAPI.sendPlanTurn(text);
    }
  };

  return (
    <Stack data-testid="plan-phase" className="plan-phase" gap={0} style={{ flex: 1, minWidth: 0 }}>
      <Group justify="space-between" p="sm" className="plan-header">
        <Text fw={600}>Plan a change</Text>
        <KiroEngineBadge />
      </Group>

      {!started ? (
        <Stack p="md" gap="sm" className="plan-entry" style={{ flex: 1 }}>
          <Group gap="sm" wrap="nowrap">
            <Button variant="default" onClick={() => void browse()}>
              Choose folder…
            </Button>
            {folderPath && (
              <Text size="sm" c="dimmed" style={{ wordBreak: "break-all" }}>
                {folderPath}
              </Text>
            )}
          </Group>
          <Textarea
            aria-label="Describe your idea"
            placeholder="Describe the change you want to plan…"
            value={idea}
            onChange={(e) => setIdea(e.currentTarget.value)}
            autosize
            minRows={3}
          />
          <Group justify="flex-end">
            <Button onClick={() => void send()} disabled={!folderPath || !idea.trim()}>
              Start refinement
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack p="md" gap="sm" className="plan-chat" style={{ flex: 1, minHeight: 0 }}>
          <ScrollArea style={{ flex: 1 }} className="plan-chat-scroll">
            <Stack gap="xs">
              {turns.map((t, i) => (
                <ChatTurn key={i} turn={t} />
              ))}
            </Stack>
          </ScrollArea>
          <Group align="flex-end" gap="sm" wrap="nowrap">
            <Textarea
              aria-label="Your reply"
              placeholder="Reply…"
              value={idea}
              onChange={(e) => setIdea(e.currentTarget.value)}
              autosize
              minRows={1}
              style={{ flex: 1 }}
            />
            <Button onClick={() => void send()} disabled={!idea.trim()}>
              Send
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
