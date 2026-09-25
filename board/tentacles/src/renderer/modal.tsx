import { useEffect, useState } from "react";
import { Modal as MantineModal, Tabs, Text, UnstyledButton } from "@mantine/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type ModalSection = { label: string; body: string };

function Markdown({ body }: { body: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

export function Modal({
  open,
  title,
  sections,
  onClose,
  onOpenInEditor,
}: {
  open: boolean;
  title: string;
  sections: ModalSection[];
  onClose: () => void;
  onOpenInEditor?: () => void;
}) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    setActive(0);
  }, [sections]);

  const multi = sections.length > 1;
  const current = sections[Math.min(active, Math.max(sections.length - 1, 0))];

  const titleNode = onOpenInEditor ? (
    <UnstyledButton onClick={onOpenInEditor} title="Open in your editor" style={{ cursor: "pointer" }}>
      <Text component="span" c="magenta" style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>
        {title} ↗
      </Text>
    </UnstyledButton>
  ) : (
    title
  );

  return (
    <MantineModal
      opened={open}
      onClose={onClose}
      title={titleNode}
      size="xl"
      transitionProps={{ duration: 0 }}
      closeButtonProps={{ "aria-label": "Close" }}
    >
      {multi ? (
        <Tabs value={String(active)} onChange={(v) => setActive(Number(v ?? 0))}>
          <Tabs.List mb="md">
            {sections.map((s, i) => (
              <Tabs.Tab key={`${s.label}\u0000${i}`} value={String(i)}>
                {s.label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <Markdown body={current?.body ?? ""} />
        </Tabs>
      ) : (
        <Markdown body={current?.body ?? ""} />
      )}
    </MantineModal>
  );
}
