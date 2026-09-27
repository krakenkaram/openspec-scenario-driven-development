import { useEffect, useState } from "react";
import { Paper, Stack, Text, Title } from "@mantine/core";
import type { Change } from "../shared/ipc-contract";

const PROPOSAL_PHASE = "proposal";

function sectionBody(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return "";
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i] as string)) break;
    body.push(lines[i] as string);
  }
  return body.join("\n").trim();
}

export function extractProposalSections(markdown: string): { problem: string; why: string } {
  return {
    problem: sectionBody(markdown, "Problem Statement"),
    why: sectionBody(markdown, "Why"),
  };
}

interface Sections {
  problem: string;
  why: string;
}

function proposalPathOf(c: Change): string | null {
  const p = c.phases.find((ph) => ph.id === PROPOSAL_PHASE);
  return p && p.done && p.files.length > 0 ? (p.files[0] as string) : null;
}

export function ProposalSummary({ changes }: { changes: Change[] }) {
  const paths = changes.map(proposalPathOf).filter((p): p is string => p !== null);
  const [sections, setSections] = useState<Sections[]>([]);
  const key = paths.join("\u0000");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const results = await Promise.all(
        paths.map(async (fp) => {
          try {
            const res = await window.electronAPI.readFile(fp);
            if (res.ok) return extractProposalSections(res.contents);
          } catch {
            /* unreadable → contributes nothing */
          }
          return { problem: "", why: "" };
        })
      );
      if (!cancelled) setSections(results);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const filled = sections.filter((s) => s.problem || s.why);
  if (filled.length === 0) return null;

  return (
    <Paper data-proposal-summary withBorder p="md" radius="md">
      <Stack gap="md">
        {filled.map((s, i) => (
          <Stack gap="xs" key={i}>
            {s.problem && (
              <Stack gap={4}>
                <Title order={3} size="h5" style={{ margin: 0 }}>
                  Problem Statement
                </Title>
                <Text style={{ whiteSpace: "pre-wrap" }}>{s.problem}</Text>
              </Stack>
            )}
            {s.why && (
              <Stack gap={4}>
                <Title order={3} size="h5" style={{ margin: 0 }}>
                  Why
                </Title>
                <Text style={{ whiteSpace: "pre-wrap" }}>{s.why}</Text>
              </Stack>
            )}
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}
