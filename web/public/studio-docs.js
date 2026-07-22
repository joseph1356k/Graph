// Documentación viva del Provider Studio: lista los docs de /studio-docs/index.json por tema y, al
// hacer clic, abre el .md renderizado en un lector modal. Sin dependencias externas (CSP-friendly):
// un mini-renderer de markdown propio. Para añadir un doc: crea el .md y agrégalo al index.json.
(function () {
  'use strict';

  var BASE = '/studio-docs/';
  var topicsEl = document.getElementById('studio-docs-topics');
  var reader = document.getElementById('studio-docs-reader');
  var content = document.getElementById('studio-docs-content');
  var closeBtn = document.getElementById('studio-docs-close');
  if (!topicsEl || !reader || !content) return;

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Inline: `code`, **bold**, *italic*, [texto](url). Se aplica sobre texto YA escapado.
  function inline(text) {
    return text
      .replace(/`([^`]+)`/g, function (_, c) { return '<code>' + c + '</code>'; })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, t, u) {
        var safe = /^https?:\/\//i.test(u) || u.charAt(0) === '/' ? u : '#';
        return '<a href="' + escapeHtml(safe) + '" target="_blank" rel="noopener">' + t + '</a>';
      });
  }

  // Mini markdown → HTML por bloques (headings, hr, listas, code fences, párrafos).
  function renderMarkdown(md) {
    var lines = md.replace(/\r\n/g, '\n').split('\n');
    var html = [];
    var i = 0;
    var inList = false;
    function closeList() { if (inList) { html.push('</ul>'); inList = false; } }

    while (i < lines.length) {
      var line = lines[i];

      if (/^```/.test(line)) {
        closeList();
        var buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; // salta el cierre ```
        html.push('<pre><code>' + escapeHtml(buf.join('\n')) + '</code></pre>');
        continue;
      }
      var h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) { closeList(); var n = h[1].length; html.push('<h' + n + '>' + inline(escapeHtml(h[2])) + '</h' + n + '>'); i++; continue; }
      if (/^\s*---\s*$/.test(line)) { closeList(); html.push('<hr>'); i++; continue; }
      var li = line.match(/^\s*[-*]\s+(.*)$/);
      if (li) { if (!inList) { html.push('<ul>'); inList = true; } html.push('<li>' + inline(escapeHtml(li[1])) + '</li>'); i++; continue; }
      if (/^\s*$/.test(line)) { closeList(); i++; continue; }

      // párrafo (junta líneas consecutivas)
      closeList();
      var para = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,4}\s|```|\s*[-*]\s|\s*---\s*$)/.test(lines[i])) {
        para.push(lines[i]); i++;
      }
      html.push('<p>' + inline(escapeHtml(para.join(' '))) + '</p>');
    }
    closeList();
    return html.join('\n');
  }

  function openDoc(doc) {
    content.innerHTML = '<p class="studio-docs-loading">Cargando…</p>';
    reader.classList.remove('is-hidden');
    fetch(BASE + doc.file)
      .then(function (r) { if (!r.ok) throw new Error('no se pudo cargar'); return r.text(); })
      .then(function (md) { content.innerHTML = renderMarkdown(md); content.scrollTop = 0; })
      .catch(function () { content.innerHTML = '<p>No se pudo cargar «' + escapeHtml(doc.title) + '».</p>'; });
  }

  function closeDoc() { reader.classList.add('is-hidden'); }

  function render(index) {
    var topics = (index && index.topics) || [];
    if (!topics.length) { topicsEl.innerHTML = '<p class="studio-docs-loading">Sin documentos aún.</p>'; return; }
    topicsEl.innerHTML = '';
    topics.forEach(function (t) {
      var group = document.createElement('div');
      group.className = 'studio-docs-group';
      var h = document.createElement('h3');
      h.className = 'studio-docs-topic';
      h.textContent = t.topic;
      group.appendChild(h);
      (t.docs || []).forEach(function (doc) {
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'studio-docs-card';
        card.innerHTML = '<span class="studio-docs-card-title"></span><span class="studio-docs-card-sum"></span>';
        card.querySelector('.studio-docs-card-title').textContent = doc.title;
        card.querySelector('.studio-docs-card-sum').textContent = doc.summary || '';
        card.addEventListener('click', function () { openDoc(doc); });
        group.appendChild(card);
      });
      topicsEl.appendChild(group);
    });
  }

  // Documentación colapsable: por defecto colapsada (solo título + subtítulo).
  var docsSection = document.getElementById('studio-docs');
  var docsToggle = document.getElementById('studio-docs-toggle');
  if (docsSection && docsToggle) {
    docsToggle.addEventListener('click', function () {
      var collapsed = docsSection.classList.toggle('is-collapsed');
      docsToggle.setAttribute('aria-expanded', String(!collapsed));
    });
  }

  if (closeBtn) closeBtn.addEventListener('click', closeDoc);
  reader.addEventListener('click', function (e) { if (e.target === reader) closeDoc(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !reader.classList.contains('is-hidden')) closeDoc(); });

  fetch(BASE + 'index.json')
    .then(function (r) { return r.json(); })
    .then(render)
    .catch(function () { topicsEl.innerHTML = '<p class="studio-docs-loading">No se pudo cargar la documentación.</p>'; });
})();
