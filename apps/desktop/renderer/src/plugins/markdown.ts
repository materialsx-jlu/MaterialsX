import DOMPurify from "dompurify";
import katex from "katex";
import MarkdownIt from "markdown-it";
import texmath from "markdown-it-texmath";

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: true,
}).use(texmath, {
  delimiters: "dollars",
  engine: katex,
  katexOptions: {
    strict: "ignore",
    throwOnError: false,
  },
});

export function renderMarkdown(source: string): string {
  const rendered = markdown.render(source);

  // Unit tests run without a browser DOM. Production rendering always passes
  // through DOMPurify; MarkdownIt's HTML mode is disabled as a first barrier.
  if (typeof window === "undefined") {
    return rendered;
  }

  return DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
  });
}
