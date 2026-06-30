const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeRelativePath(value = '') {
  return `${value || ''}`
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\.\.(\/|\\)/g, '')
    .trim();
}

function diffSummary(previousContent = '', nextContent = '') {
  const previousLines = `${previousContent || ''}`.split(/\r?\n/);
  const nextLines = `${nextContent || ''}`.split(/\r?\n/);
  const delta = nextLines.length - previousLines.length;
  if (delta > 0) {
    return `+${delta} linea${delta === 1 ? '' : 's'}`;
  }
  if (delta < 0) {
    const removed = Math.abs(delta);
    return `-${removed} linea${removed === 1 ? '' : 's'}`;
  }
  const charDelta = `${nextContent || ''}`.length - `${previousContent || ''}`.length;
  if (charDelta > 0) {
    return `+${charDelta} caracteres`;
  }
  if (charDelta < 0) {
    return `${charDelta} caracteres`;
  }
  return 'Sin cambios';
}

function buildBlocks(content = '') {
  const normalized = `${content || ''}`;
  if (!normalized) {
    return [{
      block_id: 'block-empty',
      markdown: '',
      preview: '',
      heading_path: [],
      start: 0,
      end: 0
    }];
  }

  const lines = normalized.split('\n');
  const blocks = [];
  let blockLines = [];
  let blockStart = 0;
  let offset = 0;
  let currentHeadingPath = [];

  function flushBlock(endOffset) {
    if (blockLines.length === 0) {
      return;
    }
    const markdown = blockLines.join('\n');
    const preview = markdown.replace(/\s+/g, ' ').trim().slice(0, 160);
    blocks.push({
      block_id: `block-${blocks.length + 1}`,
      markdown,
      preview: preview || '(bloque vacio)',
      heading_path: currentHeadingPath.slice(),
      start: blockStart,
      end: endOffset
    });
    blockLines = [];
  }

  lines.forEach((line, index) => {
    const isHeading = /^#{1,3}\s+/.test(line);
    const lineLengthWithBreak = line.length + (index < lines.length - 1 ? 1 : 0);

    if (isHeading && blockLines.length > 0) {
      flushBlock(offset);
      blockStart = offset;
    }

    if (isHeading) {
      const level = (line.match(/^#+/) || [''])[0].length;
      const label = line.replace(/^#{1,3}\s+/, '').trim();
      currentHeadingPath = currentHeadingPath.slice(0, Math.max(0, level - 1));
      currentHeadingPath[level - 1] = label;
    }

    if (blockLines.length === 0) {
      blockStart = offset;
    }
    blockLines.push(line);

    const isParagraphBreak = line.trim() === '' && blockLines.some((item) => item.trim() !== '');
    offset += lineLengthWithBreak;

    if (isParagraphBreak) {
      flushBlock(offset);
      blockStart = offset;
    }
  });

  flushBlock(normalized.length);
  return blocks.length > 0 ? blocks : [{
    block_id: 'block-1',
    markdown: normalized,
    preview: normalized.replace(/\s+/g, ' ').trim().slice(0, 160),
    heading_path: [],
    start: 0,
    end: normalized.length
  }];
}

class MiracleWorkspaceStore {
  constructor(options = {}) {
    this.workspaceRoot = options.workspaceRoot || path.join(process.cwd(), 'workspaces', 'miracle');
    this.knowledgeRoot = path.join(this.workspaceRoot, 'knowledge');
    this.stateRoot = options.stateRoot || path.join(process.cwd(), 'generated', 'miracle');
    this.sessionPath = path.join(this.stateRoot, 'session.json');
    this.productLlmPath = path.join(this.stateRoot, 'product-llm.json');
    ensureDir(this.knowledgeRoot);
    ensureDir(this.stateRoot);
  }

  resolveKnowledgePath(relativePath) {
    const normalized = safeRelativePath(relativePath);
    if (!normalized) {
      throw new Error('La ruta es obligatoria.');
    }
    const absolute = path.resolve(this.knowledgeRoot, normalized);
    const allowedRoot = path.resolve(this.knowledgeRoot);
    if (!absolute.startsWith(allowedRoot)) {
      throw new Error('Ruta fuera del workspace permitido.');
    }
    return { normalized, absolute };
  }

  listFiles() {
    const files = [];
    if (!fs.existsSync(this.knowledgeRoot)) {
      return { files };
    }

    const walk = (dirPath) => {
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const absolute = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          walk(absolute);
          continue;
        }
        const relative = path.relative(this.knowledgeRoot, absolute).replace(/\\/g, '/');
        files.push({
          path: relative,
          title: path.basename(relative),
          updated_at: fs.statSync(absolute).mtime.toISOString()
        });
      }
    };

    walk(this.knowledgeRoot);
    files.sort((left, right) => left.path.localeCompare(right.path));
    return { files };
  }

  readFile(relativePath) {
    const { absolute, normalized } = this.resolveKnowledgePath(relativePath);
    if (!fs.existsSync(absolute)) {
      const error = new Error('Archivo no encontrado.');
      error.statusCode = 404;
      throw error;
    }
    return {
      path: normalized,
      content: fs.readFileSync(absolute, 'utf8')
    };
  }

  createFile(relativePath, template = '') {
    const { absolute, normalized } = this.resolveKnowledgePath(relativePath);
    if (fs.existsSync(absolute)) {
      const error = new Error('El archivo ya existe.');
      error.statusCode = 409;
      throw error;
    }
    ensureDir(path.dirname(absolute));
    fs.writeFileSync(absolute, `${template || ''}`, 'utf8');
    return { ok: true, path: normalized };
  }

  writeFile(relativePath, content = '') {
    const { absolute, normalized } = this.resolveKnowledgePath(relativePath);
    ensureDir(path.dirname(absolute));
    fs.writeFileSync(absolute, `${content || ''}`, 'utf8');
    return { ok: true, path: normalized };
  }

  readJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      return fallback;
    }
  }

  writeJson(filePath, payload) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  getSession() {
    return this.readJson(this.sessionPath, {
      open_tabs: [],
      active_tab_id: '',
      untitled_count: 0,
      previous_response_id: null
    });
  }

  saveSession(payload = {}) {
    const nextPayload = {
      open_tabs: Array.isArray(payload.open_tabs) ? payload.open_tabs : [],
      active_tab_id: `${payload.active_tab_id || ''}`,
      untitled_count: Number(payload.untitled_count) || 0,
      previous_response_id: payload.previous_response_id || null
    };
    this.writeJson(this.sessionPath, nextPayload);
    return { ok: true };
  }

  buildContextPacket(payload = {}) {
    const content = `${payload.content || ''}`;
    const baselineContent = `${payload.baseline_content || ''}`;
    const cursorStart = Math.max(0, Number(payload.cursor_start) || 0);
    const blocks = buildBlocks(content);
    const activeBlock = blocks.find((block) => cursorStart >= block.start && cursorStart <= block.end)
      || blocks[0]
      || { preview: '', start: 0 };

    return {
      note_blocks: blocks,
      active_block: {
        block_id: activeBlock.block_id,
        preview: activeBlock.preview,
        start: activeBlock.start,
        end: activeBlock.end
      },
      recent_change: {
        kind: content === `${payload.previous_content || ''}` ? 'none' : 'edit',
        summary: diffSummary(payload.previous_content || '', content),
        timestamp: new Date().toISOString()
      },
      session_diff: {
        changed: content !== baselineContent,
        summary: diffSummary(baselineContent, content)
      }
    };
  }

  buildHistoryEntry(payload = {}) {
    const previousContent = `${payload.previous_content || ''}`;
    const content = `${payload.content || ''}`;
    if (previousContent === content) {
      return { kind: 'none' };
    }
    return {
      id: `change-${Date.now()}`,
      kind: 'edit',
      title: `${payload.title || payload.path || 'Nota'}`.trim(),
      summary: diffSummary(previousContent, content),
      timestamp: new Date().toISOString(),
      cursor_start: Number(payload.cursor_start) || 0,
      cursor_end: Number(payload.cursor_end) || 0
    };
  }

  getProductLlmStatus() {
    return this.readJson(this.productLlmPath, {
      providers: [
        {
          id: 'azure-foundry',
          label: 'Azure Foundry',
          requires_api_key: true,
          requires_base_url: true,
          requires_model: true,
          default_base_url: '',
          default_model: 'gpt-4.1-mini',
          recommended: true
        },
        {
          id: 'openai',
          label: 'OpenAI',
          requires_api_key: true,
          requires_base_url: false,
          requires_model: true,
          default_base_url: 'https://api.openai.com/v1',
          default_model: 'gpt-4.1-mini',
          recommended: false
        },
        {
          id: 'openrouter',
          label: 'OpenRouter',
          requires_api_key: true,
          requires_base_url: false,
          requires_model: true,
          default_base_url: 'https://openrouter.ai/api/v1',
          default_model: 'openai/gpt-4o',
          recommended: false
        }
      ],
      current_setup: {
        provider: '',
        label: '',
        base_url: '',
        model: '',
      },
      status: {
        provider: 'heuristic',
        configured: false,
        model: ''
      }
    });
  }

  saveProductLlmSetup(payload = {}) {
    const current = this.getProductLlmStatus();
    const providerId = `${payload.provider || ''}`.trim();
    const provider = current.providers.find((item) => item.id === providerId);
    if (!provider) {
      const error = new Error('Provider de hoja en blanco no soportado.');
      error.statusCode = 400;
      throw error;
    }

    const isSameProvider = providerId === current.current_setup?.provider;
    const apiKey = `${payload.api_key || ''}`.trim() || (isSameProvider ? `${current.secrets?.api_key || ''}`.trim() : '');
    const baseUrl = `${payload.base_url || (isSameProvider ? current.current_setup?.base_url : '') || provider.default_base_url || ''}`.trim();
    const model = `${payload.model || (isSameProvider ? current.current_setup?.model : '') || provider.default_model || ''}`.trim();

    if (provider.requires_api_key && !apiKey) {
      const error = new Error('La API key es obligatoria para este provider.');
      error.statusCode = 400;
      throw error;
    }

    const nextPayload = {
      ...current,
      current_setup: {
        provider: provider.id,
        label: provider.label,
        base_url: baseUrl,
        model
      },
      status: {
        provider: provider.id,
        configured: Boolean(apiKey),
        model
      },
      secrets: {
        api_key: apiKey
      }
    };
    this.writeJson(this.productLlmPath, nextPayload);
    return { ok: true, setup: nextPayload };
  }
}

module.exports = MiracleWorkspaceStore;
