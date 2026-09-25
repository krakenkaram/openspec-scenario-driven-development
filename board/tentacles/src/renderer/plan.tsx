import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Box, Button, Group, Modal as MantineModal, ScrollArea, Stack, Text, Textarea } from "@mantine/core";
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
  system: "Tentacles",
  error: "Error",
  user: "You",
};

// Consecutive turns from the same speaker are folded into one message so a run
// of lines from one amigo reads as a single message rather than many bubbles.
// Because turns arrive one line at a time as the agent generates them, a group
// grows line-by-line — the streaming effect.
interface TurnGroup {
  speaker: PlanTurn["speaker"];
  lines: string[];
}

function groupTurns(turns: PlanTurn[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  for (const turn of turns) {
    const last = groups[groups.length - 1];
    if (last && last.speaker === turn.speaker) last.lines.push(turn.text);
    else groups.push({ speaker: turn.speaker, lines: [turn.text] });
  }
  return groups;
}

function ChatGroup({ group }: { group: TurnGroup }) {
  return (
    <Box data-testid="chat-turn" data-speaker={group.speaker} className={`chat-turn speaker-${group.speaker}`}>
      <Text size="xs" fw={700} className="turn-speaker">
        {SPEAKER_LABEL[group.speaker]}
      </Text>
      <Stack gap="xs">
        {group.lines.map((line, i) => (
          <Text key={i} size="sm" data-testid="turn-line">
            {line}
          </Text>
        ))}
      </Stack>
    </Box>
  );
}

// Animated "typing" dots shown as a bubble in the chat stream while an amigo is
// generating, so the wait for the agent reads as activity rather than a freeze.
function ThinkingDots() {
  return (
    <Box data-testid="thinking" className="chat-turn thinking-bubble" aria-label="An amigo is thinking">
      <span className="thinking-dot" />
      <span className="thinking-dot" />
      <span className="thinking-dot" />
    </Box>
  );
}

export function PlanView() {
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [idea, setIdea] = useState("");
  const [turns, setTurns] = useState<PlanTurn[]>([]);
  const [streaming, setStreaming] = useState<PlanTurn | null>(null);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);

  useEffect(() => {
    const offTurn = window.electronAPI.onPlanTurn((turn) => {
      setTurns((t) => [...t, turn]);
    });
    const offStream = window.electronAPI.onPlanStream((partial) => {
      setStreaming(partial);
    });
    const offBusy = window.electronAPI.onPlanBusy((b) => {
      setBusy(b);
    });
    const offEnded = window.electronAPI.onPlanSessionEnded(() => {
      setEnded(true);
      setBusy(false);
      setStreaming(null);
    });
    return () => {
      offTurn();
      offStream();
      offBusy();
      offEnded();
    };
  }, []);

  const pushError = (text: string) => setTurns((t) => [...t, { speaker: "error", text }]);

  const browse = async () => {
    const res = await window.electronAPI.planChooseFolder();
    if (res.path) setFolderPath(res.path);
  };

  const openTicket = async () => {
    const res = await window.electronAPI.openTicket();
    if (!res.ok) pushError(`Could not open the ticket: ${res.error}`);
  };

  const confirmNewRefinement = async () => {
    setConfirmNew(false);
    const res = await window.electronAPI.newRefinement();
    if (!res.ok) {
      // Main has already stopped the session and cleared the folder, so the chat
      // is no longer live even though the wipe failed — keep it, but terminal.
      pushError(`Could not start a new refinement: ${res.error}`);
      setEnded(true);
      return;
    }
    setStarted(false);
    setEnded(false);
    setBusy(false);
    setStreaming(null);
    setTurns([]);
    setFolderPath(null);
    setIdea("");
  };

  const send = async () => {
    const text = idea.trim();
    if (!text) return;
    if (!started) {
      if (!folderPath) return;
      setTurns((t) => [...t, { speaker: "user", text }]);
      setIdea("");
      setStarted(true);
      setBusy(true);
      const res = await window.electronAPI.startPlanSession({ idea: text });
      if (!res.ok) {
        pushError(res.error);
        setBusy(false);
        setEnded(true);
      }
    } else {
      if (ended || busy) return;
      setTurns((t) => [...t, { speaker: "user", text }]);
      setIdea("");
      setBusy(true);
      const res = await window.electronAPI.sendPlanTurn(text);
      if (!res.ok) {
        pushError(res.error);
        setBusy(false);
        setEnded(true);
      }
    }
  };

  // Enter submits; Ctrl/Cmd+Enter also submits. Shift+Enter inserts a newline
  // (unless Ctrl/Cmd is held, which always submits).
  const onKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (!e.shiftKey || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void send();
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
            onKeyDown={onKey}
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
          <Group justify="flex-end" className="plan-toolbar">
            <Button variant="default" size="xs" onClick={() => void openTicket()}>
              Open ticket
            </Button>
            <Button variant="default" size="xs" color="red" onClick={() => setConfirmNew(true)}>
              New refinement
            </Button>
          </Group>
          <ScrollArea style={{ flex: 1 }} className="plan-chat-scroll">
            <Stack gap="xs">
              {groupTurns(streaming ? [...turns, streaming] : turns).map((g, i) => (
                <ChatGroup key={i} group={g} />
              ))}
              {busy && !ended && <ThinkingDots />}
            </Stack>
          </ScrollArea>
          {ended && (
            <Text size="xs" c="dimmed" data-testid="session-ended">
              The session has ended. Start a new refinement to plan again.
            </Text>
          )}
          <Group align="flex-end" gap="sm" wrap="nowrap">
            <Textarea
              aria-label="Your reply"
              placeholder={ended ? "Session ended" : busy ? "Waiting for a reply…" : "Reply…"}
              value={idea}
              onChange={(e) => setIdea(e.currentTarget.value)}
              onKeyDown={onKey}
              autosize
              minRows={1}
              disabled={ended || busy}
              style={{ flex: 1 }}
            />
            <Button onClick={() => void send()} disabled={ended || busy || !idea.trim()}>
              Send
            </Button>
          </Group>
        </Stack>
      )}

      <MantineModal
        opened={confirmNew}
        onClose={() => setConfirmNew(false)}
        title="Start a new refinement?"
        transitionProps={{ duration: 0 }}
        closeButtonProps={{ "aria-label": "Close" }}
      >
        <Text mb="md">
          This deletes the current ticket (<code>.tentacles/TICKET.html</code>) and starts over. Your
          <code> .tentacles/*.md</code> docs are kept. This cannot be undone.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setConfirmNew(false)}>
            Cancel
          </Button>
          <Button color="red" onClick={() => void confirmNewRefinement()}>
            Discard ticket and start over
          </Button>
        </Group>
      </MantineModal>
    </Stack>
  );
}
