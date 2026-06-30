import { escapeHtml, trimPreview } from "/assets/lib/text.js";

function buildFallbackBlocks(content) {
  if (!content) {
    return [{ block_id: "block-empty", markdown: "", heading_path: [], start: 0, end: 0 }];
  }

  return [
    {
      block_id: "preview-fallback",
      markdown: content,
      preview: trimPreview(content),
      heading_path: [],
      start: 0,
      end: content.length,
    },
  ];
}

function normalizeBlocks(content, blocks) {
  if (Array.isArray(blocks) && blocks.length > 0) {
    return blocks;
  }
  return buildFallbackBlocks(content);
}

export function createPreviewRenderer(editorPreview) {
  return {
    render(content, { activeBlockStart = null, blocks = [] } = {}) {
      const resolvedBlocks = normalizeBlocks(content, blocks);
      if (resolvedBlocks.length === 1 && resolvedBlocks[0].markdown === "") {
        editorPreview.innerHTML = '<p class="editor-line meta">Empieza a escribir...</p>';
        return;
      }

      editorPreview.innerHTML = resolvedBlocks
        .map((block) => {
          const lines = (block.markdown || "").split("\n");
          const renderedLines = lines
            .map((line) => {
              const escaped = escapeHtml(line);
              if (line.startsWith("### ")) {
                return `<p class="editor-line h3">${escapeHtml(line.slice(4))}</p>`;
              }
              if (line.startsWith("## ")) {
                return `<p class="editor-line h2">${escapeHtml(line.slice(3))}</p>`;
              }
              if (line.startsWith("# ")) {
                return `<p class="editor-line h1">${escapeHtml(line.slice(2))}</p>`;
              }
              if (line.trim() === "") {
                return '<p class="editor-line empty"></p>';
              }
              return `<p class="editor-line">${escaped}</p>`;
            })
            .join("");
          const headingPath = Array.isArray(block.heading_path) ? block.heading_path.join(" > ") : "";
          const headingAttr = headingPath ? ` data-heading-path="${escapeHtml(headingPath)}"` : "";
          const activeClass = activeBlockStart === block.start ? " active" : "";
          return `<section class="preview-block${activeClass}" data-block-id="${block.block_id}" data-block-start="${block.start}"${headingAttr}>${renderedLines}</section>`;
        })
        .join("");
    },
  };
}
