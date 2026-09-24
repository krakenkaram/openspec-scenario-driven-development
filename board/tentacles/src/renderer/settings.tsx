import { useEffect, useState } from "react";
import { Badge, Button, Checkbox, Group, Modal, Radio, Stack, Tabs, Text, TextInput } from "@mantine/core";
import type { NotificationSetting, ResultRow, SchemaInfo, Target } from "../shared/ipc-contract";

const NOTIFICATION_OPTIONS: Array<{ value: NotificationSetting; label: string }> = [
  { value: "enabled", label: "Notifications on" },
  { value: "silent", label: "Mute notification sounds only" },
  { value: "muted", label: "Mute notifications" },
];

const TARGET_LABELS: { id: Target; label: string }[] = [
  { id: "claude", label: "Claude" },
  { id: "kiro", label: "Kiro" },
  { id: "kiro-crew", label: "Kiro Crew" },
];

type Tab = "general" | "setup" | "schemas";

// Map a doctor check row id to its check "kind": the target family it belongs to,
// or "shared" for the OpenSpec-slice checks every selected target relies on. The
// "kirocrew-" prefix is tested before "kiro-" so Kiro Crew checks are not
// misattributed.
function checkKind(id: string): Target | "shared" {
  if (id.startsWith("claude-")) return "claude";
  if (id.startsWith("kirocrew-")) return "kiro-crew";
  if (id.startsWith("kiro-")) return "kiro";
  return "shared";
}

// The run target(s) that COVER a given check, so a failing check repairs the
// selected target whose install produces it. Kiro Crew is a superset of Kiro, so
// an inherited `kiro-*` check is covered by kiro-crew as well as kiro — a
// `kiro-*` failure in a Kiro-Crew-only run therefore repairs kiro-crew (which
// re-runs the host-wiring + restart steps), not the standalone kiro target. A
// shared OpenSpec failure is covered by every target in the run.
function coveringTargets(checkId: string, ran: Target[]): Target[] {
  const kind = checkKind(checkId);
  if (kind === "shared") return ran;
  if (kind === "claude") return ran.filter((t) => t === "claude");
  if (kind === "kiro-crew") return ran.filter((t) => t === "kiro-crew");
  // a kiro-* check is produced by both the kiro and kiro-crew installs
  return ran.filter((t) => t === "kiro" || t === "kiro-crew");
}

// The target(s) a repair should re-install: for each failing row, the run
// target(s) that cover it. Snapshotted run targets keep the mapping stable even
// if the user toggles selection between Doctor and repair.
function affectedTargets(rows: ResultRow[], ranTargets: Target[]): Target[] {
  const affected = new Set<Target>();
  for (const r of rows) {
    if (r.ok) continue;
    for (const t of coveringTargets(r.id, ranTargets)) affected.add(t);
  }
  return TARGET_LABELS.map((x) => x.id).filter((t) => affected.has(t));
}

function ResultList({ title, rows }: { title: string; rows: ResultRow[] }) {
  return (
    <Stack gap={4} mt="sm">
      <Text fw={600} size="sm">
        {title}
      </Text>
      {rows.map((r) => (
        <Group key={r.id} gap="xs" wrap="nowrap" align="flex-start">
          <Text component="span">{r.ok ? "✅" : "❌"}</Text>
          <Text component="span" size="sm">
            {r.label}
          </Text>
          {!r.ok && r.reason && (
            <Text component="span" size="sm" c="dimmed">
              {r.reason}
            </Text>
          )}
        </Group>
      ))}
    </Stack>
  );
}

export function SettingsPanel({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<Tab>("general");
  const [root, setRoot] = useState("");
  const [notifications, setNotifications] = useState<NotificationSetting>("enabled");
  const [targets, setTargets] = useState<Target[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [installResult, setInstallResult] = useState<ResultRow[] | null>(null);
  const [doctorResult, setDoctorResult] = useState<ResultRow[] | null>(null);
  const [doctorTargets, setDoctorTargets] = useState<Target[]>([]);
  const [busy, setBusy] = useState(false);
  const [schemas, setSchemas] = useState<SchemaInfo[]>([]);
  const [schemaBusy, setSchemaBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError("");
    setTab("general");
    setInstallResult(null);
    setDoctorResult(null);
    void (async () => {
      try {
        const s = await window.electronAPI.getSettings();
        setRoot(s.root);
        setNotifications(s.notifications ?? "enabled");
        setTargets(Array.isArray(s.targets) ? s.targets : []);
      } catch {
        /* leave blank */
      }
    })();
    void (async () => {
      try {
        setSchemas(await window.electronAPI.listSchemas());
      } catch {
        setSchemas([]);
      }
    })();
  }, [open]);

  const toggleTarget = (id: Target) => {
    setTargets((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await window.electronAPI.setSettings({ root, notifications, targets });
      if (res.ok) {
        onSaved();
        onClose();
      } else {
        setError(res.error);
      }
    } catch {
      setError("Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const browse = async () => {
    setError("");
    try {
      const res = await window.electronAPI.chooseDirectory();
      if (res.path) setRoot(res.path);
    } catch {
      /* dialog cancelled or unavailable — leave the field untouched */
    }
  };

  const runInstall = async (only?: Target[]) => {
    setBusy(true);
    try {
      const res = await window.electronAPI.install({ targets: only ?? targets });
      setInstallResult(res.steps);
    } catch {
      setInstallResult([{ id: "install-error", label: "Install failed", ok: false, reason: "unexpected error" }]);
    } finally {
      setBusy(false);
    }
  };

  const runDoctor = async () => {
    setBusy(true);
    setDoctorTargets(targets);
    try {
      const res = await window.electronAPI.doctor({ targets });
      setDoctorResult(res.checks);
    } catch {
      setDoctorResult([{ id: "doctor-error", label: "Doctor failed", ok: false, reason: "unexpected error" }]);
    } finally {
      setBusy(false);
    }
  };

  const applySchemaAction = async (action: "install" | "uninstall", name: string) => {
    setSchemaBusy(name);
    setError("");
    try {
      const res =
        action === "install"
          ? await window.electronAPI.installSchema(name)
          : await window.electronAPI.uninstallSchema(name);
      if (!res.ok) setError(`Could not ${action} ${name}: ${res.error}`);
      else setSchemas(await window.electronAPI.listSchemas());
    } catch {
      setError(`Could not ${action} ${name}.`);
    } finally {
      setSchemaBusy(null);
    }
  };

  const doctorHasFailure = !!doctorResult && doctorResult.some((c) => !c.ok);
  const repairTargets = doctorResult ? affectedTargets(doctorResult, doctorTargets) : [];

  return (
    <Modal
      opened={open}
      onClose={onClose}
      title="Settings"
      size="lg"
      transitionProps={{ duration: 0 }}
      closeButtonProps={{ "aria-label": "Close" }}
    >
      <Tabs value={tab} onChange={(v) => setTab((v as Tab) ?? "general")}>
        <Tabs.List mb="md">
          <Tabs.Tab value="general">General</Tabs.Tab>
          <Tabs.Tab value="setup">Setup</Tabs.Tab>
          <Tabs.Tab value="schemas">Schemas</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="general">
          <Stack gap="md">
            <Group align="flex-end" gap="sm">
              <TextInput
                id="settings-root"
                label="Scan root directory"
                value={root}
                placeholder="~/Code"
                spellCheck={false}
                onChange={(e) => setRoot(e.currentTarget.value)}
                style={{ flex: 1 }}
              />
              <Button variant="default" type="button" onClick={() => void browse()}>
                Browse…
              </Button>
            </Group>

            <Radio.Group
              value={notifications}
              onChange={(v) => setNotifications(v as NotificationSetting)}
              label="Notifications"
            >
              <Stack gap="xs" mt="xs">
                {NOTIFICATION_OPTIONS.map((opt) => (
                  <Radio key={opt.value} value={opt.value} label={opt.label} />
                ))}
              </Stack>
            </Radio.Group>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="setup">
          <Stack gap="md">
            <Text fw={600} size="sm">
              Configure this machine for
            </Text>
            <Group>
              {TARGET_LABELS.map(({ id, label }) => (
                <Checkbox
                  key={id}
                  label={label}
                  checked={targets.includes(id)}
                  onChange={() => toggleTarget(id)}
                />
              ))}
            </Group>
            <Group>
              <Button onClick={() => void runInstall()} disabled={busy || targets.length === 0}>
                Install
              </Button>
              <Button variant="default" onClick={() => void runDoctor()} disabled={busy || targets.length === 0}>
                Run doctor
              </Button>
            </Group>
            {installResult && <ResultList title="Install" rows={installResult} />}
            {doctorResult && <ResultList title="Doctor" rows={doctorResult} />}
            {doctorHasFailure && (
              <Button color="orange" onClick={() => void runInstall(repairTargets)} disabled={busy}>
                Fix detected issues
              </Button>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="schemas">
          <Stack gap="sm">
            <Text fw={600} size="sm">
              Available schemas
            </Text>
            {schemas.length === 0 ? (
              <Text c="dimmed">No schemas available.</Text>
            ) : (
              <Stack gap="sm">
                {schemas.map((s) => (
                  <Stack key={s.name} gap={4} p="sm" style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 8 }}>
                    <Group gap="xs">
                      <Text fw={600}>{s.name}</Text>
                      <Badge variant="light" color={s.scope === "global" ? "blue" : "gray"}>
                        {s.scope === "global" ? "Global" : "Local"}
                      </Badge>
                      <span style={{ flex: 1 }} />
                      {s.action === "install" && (
                        <Button
                          type="button"
                          size="compact-sm"
                          disabled={schemaBusy === s.name}
                          onClick={() => void applySchemaAction("install", s.name)}
                        >
                          {schemaBusy === s.name ? "Installing…" : "Install"}
                        </Button>
                      )}
                      {s.action === "uninstall" && (
                        <Button
                          type="button"
                          variant="default"
                          size="compact-sm"
                          disabled={schemaBusy === s.name}
                          onClick={() => void applySchemaAction("uninstall", s.name)}
                        >
                          {schemaBusy === s.name ? "Uninstalling…" : "Uninstall"}
                        </Button>
                      )}
                    </Group>
                    {s.path && (
                      <Text size="xs" c="dimmed">
                        {s.path}
                      </Text>
                    )}
                    {s.description && <Text size="sm">{s.description}</Text>}
                    <Text size="xs" c="dimmed">
                      {s.artifacts.join(" → ")}
                    </Text>
                  </Stack>
                ))}
              </Stack>
            )}
          </Stack>
        </Tabs.Panel>
      </Tabs>

      {error && (
        <Text c="red" mt="sm">
          {error}
        </Text>
      )}
      <Group justify="flex-end" mt="md">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </Group>
    </Modal>
  );
}
