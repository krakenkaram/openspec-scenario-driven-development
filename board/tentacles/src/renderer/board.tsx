import { Fragment } from "react";
import {
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import type { Change, Phase } from "../shared/ipc-contract";

interface WithOpen {
  openArtifacts: (files: string[]) => void;
}

type NodeTone = "done" | "progress" | "pending" | "na";

const toneColor: Record<NodeTone, string> = {
  done: "teal",
  progress: "blue",
  pending: "gray",
  na: "gray",
};

function Node({
  phase,
  state,
  tone,
  onOpen,
}: {
  phase: string;
  state: React.ReactNode;
  tone: NodeTone;
  onOpen?: () => void;
}) {
  const body = (
    <Stack gap={2} align="center">
      <Text size="xs" fw={600} tt="uppercase" c="dimmed">
        {phase}
      </Text>
      <Text size="sm" component="div" c={tone === "pending" || tone === "na" ? "dimmed" : toneColor[tone]}>
        {state}
      </Text>
    </Stack>
  );
  const border = `1px solid var(--mantine-color-${tone === "pending" || tone === "na" ? "gray" : toneColor[tone]}-light-color)`;
  if (onOpen) {
    return (
      <UnstyledButton
        data-phase={phase}
        data-tone={tone}
        onClick={onOpen}
        p="xs"
        style={{ borderRadius: 8, border, minWidth: 96 }}
      >
        {body}
      </UnstyledButton>
    );
  }
  return (
    <Box data-phase={phase} data-tone={tone} p="xs" style={{ borderRadius: 8, border, minWidth: 96, opacity: tone === "na" ? 0.5 : 1 }}>
      {body}
    </Box>
  );
}

const inProgressState = (label: string) => (
  <Group gap={4} justify="center" wrap="nowrap">
    <Loader size={12} />
    {label}
  </Group>
);

function PhaseNode({ p, openArtifacts }: { p: Phase; openArtifacts: (files: string[]) => void }) {
  if (!p.applicable) return <Node phase={p.id} state="n/a" tone="na" />;
  if (p.inProgress) {
    const openable = p.fileExists && p.files.length > 0;
    return (
      <Node
        phase={p.id}
        state={inProgressState("in progress")}
        tone="progress"
        onOpen={openable ? () => openArtifacts(p.files) : undefined}
      />
    );
  }
  return (
    <Node
      phase={p.id}
      state={p.done ? "✓ done" : "· pending"}
      tone={p.done ? "done" : "pending"}
      onOpen={p.done && p.files.length ? () => openArtifacts(p.files) : undefined}
    />
  );
}

function ApplyNode({ c, openArtifacts }: { c: Change } & WithOpen) {
  const a = c.apply;
  let label: React.ReactNode;
  if (a.source === "commits") {
    label = c.applyDone ? `✓ ${a.commits} commits` : c.applying ? inProgressState(`${a.commits} commit(s)`) : `${a.commits} commit(s)`;
  } else {
    const count = `${a.done || 0}/${a.total}`;
    label = c.applyDone ? `✓ ${a.done}/${a.total}` : c.applying ? inProgressState(count) : count;
  }
  const tone: NodeTone = c.applyDone ? "done" : c.applying ? "progress" : "pending";
  return (
    <Node
      phase="apply"
      state={label}
      tone={tone}
      onOpen={a.file ? () => openArtifacts([a.file as string]) : undefined}
    />
  );
}

function ReviewNode({ c }: { c: Change }) {
  if (c.review === "passed") return <Node phase="review" state="✓ Agent Approved" tone="done" />;
  if (c.review === "pending") return <Node phase="review" state={inProgressState("in review")} tone="progress" />;
  return <Node phase="review" state="· pending" tone="pending" />;
}

function DoneNode({ c }: { c: Change }) {
  if (c.pr) {
    const tone: NodeTone = c.complete ? "done" : "progress";
    const state = c.pr.state === "MERGED" ? "✓ merged" : c.pr.state.toLowerCase();
    const border = `1px solid var(--mantine-color-${toneColor[tone]}-light-color)`;
    return (
      <Anchor
        href={c.pr.url}
        target="_blank"
        rel="noopener"
        underline="never"
        p="xs"
        style={{ borderRadius: 8, border, minWidth: 96 }}
      >
        <Stack gap={2} align="center">
          <Text size="xs" fw={600} tt="uppercase" c="dimmed">
            done
          </Text>
          <Text size="sm" c={toneColor[tone]}>
            PR ↗ {state}
          </Text>
        </Stack>
      </Anchor>
    );
  }
  return <Node phase="done" state="· no PR" tone="pending" />;
}

function Arrow() {
  return (
    <Text c="dimmed" aria-hidden>
      →
    </Text>
  );
}

export function ChangeCard({
  c,
  showBranch,
  openArtifacts,
  onArchive,
  busy,
  removing,
}: { c: Change; showBranch: boolean; onArchive: (c: Change) => void; busy: boolean; removing: boolean } & WithOpen) {
  const reduceMotion = useReducedMotion();
  const statusBadge = c.complete ? (
    <Badge color="teal">COMPLETE</Badge>
  ) : c.review === "pending" ? (
    <Badge color="blue">IN REVIEW</Badge>
  ) : c.applying ? (
    <Badge color="blue">APPLYING</Badge>
  ) : (
    <Badge color="gray">PLANNING</Badge>
  );
  const typeBadge =
    c.type === "refactor" ? (
      <Badge color="grape" variant="light">REFACTOR</Badge>
    ) : (
      <Badge color="cyan" variant="light">FEATURE</Badge>
    );

  return (
    <Paper
      data-change-card
      withBorder
      p="md"
      radius="md"
      style={{ opacity: removing ? 0.4 : 1, transition: reduceMotion ? undefined : "opacity 180ms ease" }}
    >
      <Group gap="xs" mb="sm" wrap="wrap">
        <Title order={2} size="h4" style={{ margin: 0 }}>
          {c.change}
        </Title>
        {showBranch && c.branch ? (
          <Badge variant="outline" color="gray" tt="none" style={{ fontFamily: "monospace" }}>
            {c.branch}
          </Badge>
        ) : null}
        {typeBadge}
        {statusBadge}
        <Button
          variant="subtle"
          size="compact-xs"
          color="gray"
          title={`Reveal the ${c.schema} schema.yaml in Finder`}
          onClick={async () => {
            const res = await window.electronAPI.openSchemaFile(c.schema, c.repoPath);
            if (!res.ok) window.alert("Could not open schema: " + res.error);
          }}
        >
          {c.schema}
        </Button>
        {c.pr && (
          <Anchor
            href={c.pr.url}
            target="_blank"
            rel="noopener"
            size="sm"
            title={`Open pull request #${c.pr.number}`}
          >
            #{c.pr.number}
          </Anchor>
        )}
        <Button
          variant="default"
          size="compact-xs"
          onClick={async () => {
            const res = await window.electronAPI.openPath(c.repoPath);
            if (!res.ok) window.alert("Could not open folder: " + res.error);
          }}
        >
          View in Finder
        </Button>
        <Button variant="default" size="compact-xs" onClick={() => onArchive(c)} disabled={busy}>
          {busy ? "Archiving…" : "Archive"}
        </Button>
      </Group>
      <Group gap="xs" wrap="wrap" align="stretch">
        {c.phases.map((p, i) => (
          <Fragment key={p.id}>
            {i > 0 && <Arrow />}
            <PhaseNode p={p} openArtifacts={openArtifacts} />
          </Fragment>
        ))}
        <Arrow />
        <ApplyNode c={c} openArtifacts={openArtifacts} />
        <Arrow />
        <ReviewNode c={c} />
        <Arrow />
        <DoneNode c={c} />
      </Group>
    </Paper>
  );
}

export function RepoGroup({
  repositoryId,
  repositoryName,
  nested,
  list,
  collapsed,
  onToggle,
  openArtifacts,
  onArchive,
  archivingKeys,
  removingKeys,
}: {
  repositoryId: string;
  repositoryName: string;
  nested: boolean;
  list: Change[];
  collapsed: boolean;
  onToggle: (repositoryId: string) => void;
  onArchive: (c: Change) => void;
  archivingKeys: Set<string>;
  removingKeys: Set<string>;
} & WithOpen) {
  const done = list.filter((c) => c.complete).length;
  return (
    <Stack gap="sm">
      <UnstyledButton onClick={() => onToggle(repositoryId)}>
        <Group gap="xs">
          <Text c="dimmed">{collapsed ? "▶" : "▼"}</Text>
          <Text fw={700}>{repositoryName}</Text>
          <Text size="sm" c="dimmed">
            {list.length} change(s) · {done} complete
          </Text>
        </Group>
      </UnstyledButton>
      {!collapsed && (
        <Stack gap="sm">
          {list.map((c) => {
            const k = `${c.repoPath}\u0000${c.change}`;
            return (
              <ChangeCard
                key={k}
                c={c}
                showBranch={nested}
                openArtifacts={openArtifacts}
                onArchive={onArchive}
                busy={archivingKeys.has(k)}
                removing={removingKeys.has(k)}
              />
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
