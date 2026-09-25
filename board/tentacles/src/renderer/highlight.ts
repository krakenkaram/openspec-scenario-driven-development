import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  scss: "css",
  less: "css",
  html: "xml",
  xml: "xml",
  svg: "xml",
  vue: "xml",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  sql: "sql",
};

export function languageForPath(path: string): string | null {
  const name = path.split("/").pop() ?? path;
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : undefined;
  if (!ext) return null;
  return EXT_TO_LANGUAGE[ext] ?? null;
}

// Returns highlight.js token HTML (entities escaped by hljs) for a single line, or
// null when the language is unknown so the caller renders the raw text as a text
// node instead. Never returns unescaped input, so the caller's dangerouslySet use
// stays XSS-safe.
const highlightCache = new Map<string, string>();
const HIGHLIGHT_CACHE_MAX = 5000;
// Skip caching very long lines (e.g. minified bundles): the key holds the whole
// source line and the value its highlighted HTML, so caching unbounded-length
// lines would let a few of them dominate retained memory in this long-running,
// polling app. They are still highlighted, just never stored.
const HIGHLIGHT_MAX_LINE = 2000;

export function highlightLine(text: string, language: string | null): string | null {
  if (!language) return null;
  const cacheable = text.length <= HIGHLIGHT_MAX_LINE;
  const key = `${language}\u0000${text}`;
  if (cacheable) {
    const cached = highlightCache.get(key);
    if (cached !== undefined) return cached;
  }
  let value: string;
  try {
    value = hljs.highlight(text, { language, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
  if (cacheable) {
    if (highlightCache.size >= HIGHLIGHT_CACHE_MAX) highlightCache.clear();
    highlightCache.set(key, value);
  }
  return value;
}
