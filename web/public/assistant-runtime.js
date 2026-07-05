(function () {
    const DEFAULTS = {
        name: 'Miracle',
        accentColor: '#0f5f8c',
        idleMessage: 'Listo para ayudarte aqui.',
        zIndex: 2147483000
    };

    const state = {
        options: { ...DEFAULTS },
        mounted: false,
        currentTour: null,
        currentStopIndex: -1,
        listeners: new Map(),
        pinned: false,
        dragging: {
            active: false,
            pointerId: null,
            startX: 0,
            startY: 0,
            moved: false,
            offsetX: 0,
            offsetY: 0
        },
        speech: {
            displayedText: '',
            targetText: '',
            typingTimer: null,
            currentUtterance: null,
            selectedVoice: null
        },
        interaction: {
            lastTouchAt: 0
        },
        ui: {
            expanded: false,
            escapeBound: false
        },
        activity: {
            voice: false,
            note: false,
            recording: false,
            executing: false,
            filling: false,
            review: false
        },
        chat: {
            open: false
        },
        note: {
            open: false
        },
        face: {
            mode: 'idle',
            blinkFactor: 1,
            targetSide: 'left',
            blinkTimer: null,
            blinkRestoreTimer: null
        }
    };
    const ACTIVITY_LABELS = {
        voice: 'voz activa',
        note: 'dictado activo',
        recording: 'grabacion activa',
        executing: 'ejecucion activa',
        filling: 'llenando campos',
        review: 'revision pendiente'
    };
    const MODE_LABELS = {
        listening: 'Escuchando',
        organizing: 'Organizando',
        filling: 'Llenando campos',
        review: 'Necesita revision',
        executing: 'Ejecutando'
    };
    const trustedHtmlPolicy = (() => {
        if (!window.trustedTypes?.createPolicy) {
            return null;
        }
        try {
            return window.trustedTypes.createPolicy('graph-assistant-runtime-html', {
                createHTML(value) {
                    return value;
                }
            });
        } catch (error) {
            return null;
        }
    })();

    const FACE_PRESETS = {
        smile: {
            eyeOpenness: 0.85,
            eyeSquint: 0.15,
            leftBrowHeight: 2,
            rightBrowHeight: 2.5,
            leftBrowCurve: 0.3,
            rightBrowCurve: 0.4,
            mouthCurve: 0.7,
            mouthWidth: 1.1,
            leftCornerHeight: 0.3,
            rightCornerHeight: 0.5,
            mouthOpenness: 0
        },
        mild_attention: {
            eyeOpenness: 0.85,
            eyeSquint: 0.15,
            leftBrowHeight: 0,
            rightBrowHeight: 4,
            leftBrowCurve: 0.2,
            rightBrowCurve: 0.5,
            mouthCurve: 0.6,
            mouthWidth: 0.92,
            leftCornerHeight: 0,
            rightCornerHeight: 0.5,
            mouthOpenness: 0
        },
        thinking: {
            eyeOpenness: 0.75,
            eyeSquint: 0.2,
            leftBrowHeight: -1,
            rightBrowHeight: 4,
            leftBrowCurve: 0.1,
            rightBrowCurve: 0.5,
            mouthCurve: 0.7,
            mouthWidth: 0.95,
            leftCornerHeight: 0.2,
            rightCornerHeight: 0.1,
            mouthOpenness: 0
        }
    };

    function setElementHtml(element, html) {
        if (!element) {
            return;
        }
        const safeHtml = trustedHtmlPolicy ? trustedHtmlPolicy.createHTML(html) : html;
        element.innerHTML = safeHtml;
    }

    function escapeHtml(value) {
        return `${value || ''}`
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function renderInlineMarkdown(text) {
        let out = escapeHtml(text);
        out = out.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
        out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
        out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
        out = out.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
        out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
            const safeHref = href.replace(/"/g, '%22');
            return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        });
        return out;
    }

    function renderMarkdown(text) {
        const source = `${text || ''}`.replace(/\r\n/g, '\n');
        if (!source.trim()) {
            return '';
        }

        const lines = source.split('\n');
        const out = [];
        let paragraph = [];
        let listType = null;
        let inCodeBlock = false;
        let codeBuffer = [];

        const flushParagraph = () => {
            if (paragraph.length === 0) return;
            out.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
            paragraph = [];
        };
        const closeList = () => {
            if (listType) {
                out.push(`</${listType}>`);
                listType = null;
            }
        };
        const openList = (type) => {
            if (listType !== type) {
                closeList();
                out.push(`<${type}>`);
                listType = type;
            }
        };

        for (const raw of lines) {
            if (inCodeBlock) {
                if (/^```/.test(raw)) {
                    out.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
                    codeBuffer = [];
                    inCodeBlock = false;
                } else {
                    codeBuffer.push(raw);
                }
                continue;
            }

            if (/^```/.test(raw)) {
                flushParagraph();
                closeList();
                inCodeBlock = true;
                continue;
            }

            const trimmed = raw.trim();

            if (!trimmed) {
                flushParagraph();
                closeList();
                continue;
            }

            if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
                flushParagraph();
                closeList();
                out.push('<hr>');
                continue;
            }

            const heading = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
            if (heading) {
                flushParagraph();
                closeList();
                const level = heading[1].length;
                out.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
                continue;
            }

            const quote = trimmed.match(/^>\s?(.*)$/);
            if (quote) {
                flushParagraph();
                closeList();
                out.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`);
                continue;
            }

            const ul = trimmed.match(/^[-*+]\s+(.+)$/);
            if (ul) {
                flushParagraph();
                openList('ul');
                out.push(`<li>${renderInlineMarkdown(ul[1])}</li>`);
                continue;
            }

            const ol = trimmed.match(/^\d+\.\s+(.+)$/);
            if (ol) {
                flushParagraph();
                openList('ol');
                out.push(`<li>${renderInlineMarkdown(ol[1])}</li>`);
                continue;
            }

            closeList();
            paragraph.push(trimmed);
        }

        if (inCodeBlock && codeBuffer.length) {
            out.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
        }
        flushParagraph();
        closeList();
        return out.join('');
    }

    function quadraticBezier(start, control, end) {
        return `M${start.x},${start.y} Q${control.x},${control.y} ${end.x},${end.y}`;
    }

    function cubicBezier(start, control1, control2, end) {
        return `M${start.x},${start.y} C${control1.x},${control1.y} ${control2.x},${control2.y} ${end.x},${end.y}`;
    }

    function verticalLine(start, length) {
        return `M${start.x},${start.y} L${start.x},${start.y + length}`;
    }

    function generateEyebrowPath(baseX, baseY, width, height, curve, flip = false) {
        const halfWidth = width / 2;
        const flipMultiplier = flip ? -1 : 1;
        const startX = baseX - halfWidth * flipMultiplier;
        const endX = baseX + halfWidth * flipMultiplier;
        const startY = baseY - height;
        const endY = baseY - height;
        const controlX = baseX;
        const controlY = baseY - height - (curve * 15);

        return quadraticBezier(
            { x: startX, y: startY },
            { x: controlX, y: controlY },
            { x: endX, y: endY }
        );
    }

    function generateEyePath(centerX, centerY, openness, squint = 0) {
        const lineHeight = 25 * openness * (1 - squint * 0.4);
        const verticalOffset = lineHeight / 2;
        return verticalLine({ x: centerX, y: centerY - verticalOffset }, Math.max(0, lineHeight));
    }

    function generateMouthPath(centerX, centerY, width, curve, leftCorner, rightCorner, openness = 0) {
        const halfWidth = width / 2;
        const baseOffset = curve * 15;
        const leftY = centerY - baseOffset - (leftCorner * 8);
        const rightY = centerY - baseOffset - (rightCorner * 8);
        const start = { x: centerX - halfWidth, y: leftY };
        const end = { x: centerX + halfWidth, y: rightY };
        const curveDepth = -curve * 12;
        const midY = centerY + curveDepth;
        const asymmetryShift = (rightCorner - leftCorner) * 10;
        const control1 = { x: centerX - halfWidth * 0.3 + asymmetryShift, y: midY };
        const control2 = { x: centerX + halfWidth * 0.3 + asymmetryShift, y: midY };

        if (openness > 0.05) {
            const bottomOffset = openness * 15;
            const bottomY = centerY + bottomOffset;
            const topPath = cubicBezier(start, control1, control2, end);
            return topPath + ` Q${centerX},${bottomY} ${start.x},${leftY}`;
        }

        return cubicBezier(start, control1, control2, end);
    }

    function renderAssistantFace(mode = state.face.mode || 'idle') {
        const leftEyebrow = document.getElementById('graph-assistant-left-eyebrow');
        const rightEyebrow = document.getElementById('graph-assistant-right-eyebrow');
        const leftEye = document.getElementById('graph-assistant-left-eye-line');
        const rightEye = document.getElementById('graph-assistant-right-eye-line');
        const mouth = document.getElementById('graph-assistant-mouth');
        const faceGroup = document.getElementById('graph-assistant-face-group');

        if (!leftEyebrow || !rightEyebrow || !leftEye || !rightEye || !mouth || !faceGroup) {
            return;
        }

        const preset = mode === 'tour' || mode === 'listening'
            ? FACE_PRESETS.mild_attention
            : mode === 'executing' || mode === 'organizing' || mode === 'filling'
                ? FACE_PRESETS.thinking
                : FACE_PRESETS.smile;

        const isLookingRight = state.face.targetSide === 'right';
        const gazeOffset = isLookingRight ? 4.5 : -4.5;
        const blinkFactor = state.face.blinkFactor;
        let leftBrowHeight = preset.leftBrowHeight;
        let rightBrowHeight = preset.rightBrowHeight;
        let leftBrowCurve = preset.leftBrowCurve;
        let rightBrowCurve = preset.rightBrowCurve;
        let leftCornerHeight = preset.leftCornerHeight;
        let rightCornerHeight = preset.rightCornerHeight;

        if (isLookingRight) {
            [leftBrowHeight, rightBrowHeight] = [rightBrowHeight, leftBrowHeight];
            [leftBrowCurve, rightBrowCurve] = [rightBrowCurve, leftBrowCurve];
            [leftCornerHeight, rightCornerHeight] = [rightCornerHeight, leftCornerHeight];
        }

        const faceRotation = isLookingRight ? 2 : -2;
        faceGroup.setAttribute('transform', `rotate(${faceRotation})`);

        leftEyebrow.setAttribute('d', generateEyebrowPath(-30, -34, 20, leftBrowHeight, leftBrowCurve, false));
        rightEyebrow.setAttribute('d', generateEyebrowPath(30, -34, 20, rightBrowHeight, rightBrowCurve, true));
        leftEye.setAttribute('d', generateEyePath(-30 + gazeOffset, -14, preset.eyeOpenness * blinkFactor, preset.eyeSquint));
        rightEye.setAttribute('d', generateEyePath(30 + gazeOffset, -14, preset.eyeOpenness * blinkFactor, preset.eyeSquint));
        mouth.setAttribute(
            'd',
            generateMouthPath(0, 34, 34 * preset.mouthWidth, preset.mouthCurve, leftCornerHeight, rightCornerHeight, preset.mouthOpenness)
        );
    }

    function scheduleNextBlink() {
        if (state.face.blinkTimer) {
            clearTimeout(state.face.blinkTimer);
        }
        state.face.blinkTimer = setTimeout(() => {
            state.face.blinkFactor = 0;
            renderAssistantFace();

            if (state.face.blinkRestoreTimer) {
                clearTimeout(state.face.blinkRestoreTimer);
            }
            state.face.blinkRestoreTimer = setTimeout(() => {
                state.face.blinkFactor = 1;
                renderAssistantFace();
                scheduleNextBlink();
            }, 110);
        }, 1800 + Math.random() * 2200);
    }

    function ensureFaceAnimation() {
        if (state.face.blinkTimer || state.face.blinkRestoreTimer) {
            return;
        }
        scheduleNextBlink();
    }

    function updateFaceDirectionFromShell() {
        const { shell } = ensureElements();
        const rect = shell.getBoundingClientRect();
        const midpoint = rect.left + rect.width / 2;
        state.face.targetSide = midpoint < (window.innerWidth / 2) ? 'right' : 'left';
        renderAssistantFace();
    }

    function ensureStyles() {
        if (document.getElementById('graph-assistant-runtime-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'graph-assistant-runtime-styles';
        style.textContent = `
            :root {
                --graph-assistant-glass-size: 151px;
                --graph-assistant-glass-radius: 999px;
                --graph-assistant-glass-highlight: rgba(255, 255, 255, 0.12);
                --graph-assistant-glass-mid: rgba(255, 255, 255, 0.05);
                --graph-assistant-glass-shadow: rgba(0, 0, 0, 0.35);
                --graph-assistant-glass-border: rgba(255, 255, 255, 0.18);
                --graph-assistant-face-tint: #ffffff;
            }
            .graph-assistant-shell {
                position: fixed;
                left: calc(100vw - 96px);
                top: calc(100vh - 164px);
                width: var(--graph-assistant-glass-size);
                height: var(--graph-assistant-glass-size);
                z-index: var(--graph-assistant-z, 2147483000);
                pointer-events: none;
                transition: left 320ms cubic-bezier(0.22, 1, 0.36, 1), top 320ms cubic-bezier(0.22, 1, 0.36, 1);
            }
            .graph-assistant-shell[data-dragging="true"] {
                transition: none;
            }
            .graph-assistant-shell[data-state="listening"] .graph-assistant-avatar,
            .graph-assistant-shell[data-state="organizing"] .graph-assistant-avatar,
            .graph-assistant-shell[data-state="filling"] .graph-assistant-avatar,
            .graph-assistant-shell[data-state="review"] .graph-assistant-avatar,
            .graph-assistant-shell[data-state="tour"] .graph-assistant-avatar,
            .graph-assistant-shell[data-state="executing"] .graph-assistant-avatar {
                transform: translateY(-2px) scale(1.02);
            }
            .graph-assistant-shell[data-has-activity="true"] .graph-assistant-avatar::before {
                content: "";
                position: absolute;
                inset: 8px;
                border-radius: inherit;
                border: 1px solid rgba(15, 95, 140, 0.34);
                opacity: 0.78;
                animation: graphAssistantActivePulse 1.8s ease-in-out infinite;
                pointer-events: none;
            }
            .graph-assistant-shell[data-has-activity="true"] .graph-assistant-avatar::after {
                content: "";
                position: absolute;
                right: 17px;
                bottom: 18px;
                width: 13px;
                height: 13px;
                border-radius: 999px;
                background: #10b981;
                box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.18), 0 6px 18px rgba(0, 0, 0, 0.28);
                pointer-events: none;
            }
            .graph-assistant-shell[data-activity~="voice"] .graph-assistant-avatar::after,
            .graph-assistant-shell[data-activity~="note"] .graph-assistant-avatar::after,
            .graph-assistant-shell[data-activity~="recording"] .graph-assistant-avatar::after {
                background: #ef4444;
                box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.18), 0 6px 18px rgba(0, 0, 0, 0.28);
            }
            .graph-assistant-shell[data-activity~="filling"] .graph-assistant-avatar::after {
                background: #0ea5e9;
                box-shadow: 0 0 0 4px rgba(14, 165, 233, 0.18), 0 6px 18px rgba(0, 0, 0, 0.28);
            }
            .graph-assistant-shell[data-activity~="review"] .graph-assistant-avatar::after {
                background: #f59e0b;
                box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.22), 0 6px 18px rgba(0, 0, 0, 0.28);
            }
            body[data-assistant-expanded="false"] .graph-assistant-bubble,
            body[data-assistant-expanded="false"] .graph-assistant-user-bubble,
            body[data-assistant-expanded="false"] .graph-assistant-chat-toggle,
            body[data-assistant-expanded="false"] .graph-assistant-note-toggle,
            body[data-assistant-expanded="false"] .graph-assistant-chat-composer {
                opacity: 0 !important;
                pointer-events: none !important;
                transform: translateY(10px) scale(0.94) !important;
            }
            body[data-assistant-expanded="false"] .graph-assistant-note-panel {
                display: none !important;
            }
            body[data-assistant-expanded="false"] #teaching-console {
                opacity: 0 !important;
                pointer-events: none !important;
                transform: translateX(-50%) translateY(12px) scale(0.94) !important;
            }
            body[data-assistant-expanded="true"] #teaching-console {
                opacity: 1;
            }
            .graph-assistant-bubble {
                position: fixed;
                left: 16px;
                top: 16px;
                z-index: calc(var(--graph-assistant-z, 2147483000) + 1);
                max-width: min(320px, calc(100vw - 136px));
                padding: 12px 14px;
                padding-bottom: 22px;
                border-radius: 18px;
                background: rgba(20, 27, 34, 0.94);
                color: #f8fbff;
                font: 500 13px/1.45 "Inter", "Segoe UI", sans-serif;
                box-shadow:
                    0 24px 64px rgba(2, 8, 18, 0.55),
                    0 0 0 1px rgba(255, 255, 255, 0.12),
                    0 0 34px rgba(255, 255, 255, 0.12),
                    0 10px 28px rgba(255, 255, 255, 0.08);
                opacity: 0;
                transform: translateY(8px);
                transition: opacity 180ms ease, transform 180ms ease;
                backdrop-filter: blur(14px);
                pointer-events: none;
            }
            .graph-assistant-bubble[data-visible="true"] {
                opacity: 1;
                transform: translateY(0);
            }
            .graph-assistant-bubble-text {
                display: block;
                white-space: pre-wrap;
            }
            .graph-assistant-user-bubble {
                position: fixed;
                left: 16px;
                top: 16px;
                z-index: calc(var(--graph-assistant-z, 2147483000) + 2);
                max-width: min(280px, calc(100vw - 152px));
                padding: 10px 12px;
                border-radius: 16px;
                background: rgba(255, 255, 255, 0.98);
                color: #102033;
                font: 600 12px/1.4 "Inter", "Segoe UI", sans-serif;
                box-shadow: 0 20px 44px rgba(5, 10, 20, 0.24);
                opacity: 0;
                transform: translateY(8px);
                transition: opacity 140ms ease, transform 140ms ease;
                pointer-events: none;
            }
            .graph-assistant-user-bubble[data-visible="true"] {
                opacity: 1;
                transform: translateY(0);
            }
            .graph-assistant-chat-toggle {
                position: fixed;
                width: 42px;
                height: 42px;
                border: none;
                border-radius: 999px;
                background: rgba(255, 255, 255, 0.98);
                color: #102033;
                box-shadow:
                    0 18px 36px rgba(4, 10, 20, 0.32),
                    0 0 0 1px rgba(255, 255, 255, 0.78);
                z-index: calc(var(--graph-assistant-z, 2147483000) + 3);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                pointer-events: auto;
                transition: transform 140ms ease, box-shadow 140ms ease, background 140ms ease;
            }
            .graph-assistant-chat-toggle:hover {
                transform: translateY(-1px);
                box-shadow:
                    0 22px 42px rgba(4, 10, 20, 0.38),
                    0 0 0 1px rgba(255, 255, 255, 0.88);
            }
            .graph-assistant-chat-toggle[data-active="true"] {
                background: rgba(255, 255, 255, 0.98);
            }
            .graph-assistant-chat-toggle svg {
                width: 18px;
                height: 18px;
            }
            .graph-assistant-chat-composer {
                position: fixed;
                left: 16px;
                top: 16px;
                z-index: calc(var(--graph-assistant-z, 2147483000) + 4);
                width: min(320px, calc(100vw - 32px));
                display: grid;
                gap: 8px;
                opacity: 0;
                transform: translateY(8px);
                transition: opacity 180ms ease, transform 180ms ease;
                pointer-events: none;
            }
            .graph-assistant-chat-composer[data-visible="true"] {
                opacity: 1;
                transform: translateY(0);
                pointer-events: auto;
            }
            .graph-assistant-chat-composer textarea {
                width: 100%;
                min-height: 48px;
                max-height: 140px;
                resize: vertical;
                border: none;
                border-radius: 18px;
                padding: 12px 14px;
                box-sizing: border-box;
                background: rgba(255, 255, 255, 0.98);
                color: #102033;
                font: 500 13px/1.45 "Inter", "Segoe UI", sans-serif;
                box-shadow:
                    0 20px 44px rgba(5, 10, 20, 0.24),
                    0 0 0 1px rgba(255, 255, 255, 0.8);
                backdrop-filter: blur(14px);
                outline: none;
            }
            .graph-assistant-chat-composer textarea::placeholder {
                color: rgba(16, 32, 51, 0.5);
            }
            .graph-assistant-chat-composer textarea:focus {
                box-shadow:
                    0 20px 44px rgba(5, 10, 20, 0.24),
                    0 0 0 1px rgba(15, 95, 140, 0.18),
                    0 0 0 4px rgba(15, 95, 140, 0.08);
            }
            .graph-assistant-chat-composer-actions {
                display: flex;
                justify-content: flex-end;
                gap: 8px;
            }
            .graph-assistant-chat-send {
                border: none;
                border-radius: 999px;
                width: 40px;
                height: 40px;
                padding: 0;
                background: rgba(255, 255, 255, 0.98);
                color: #102033;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                box-shadow:
                    0 18px 36px rgba(4, 10, 20, 0.18),
                    0 0 0 1px rgba(255, 255, 255, 0.8);
            }
            .graph-assistant-chat-send svg {
                width: 16px;
                height: 16px;
            }
            .graph-assistant-chat-send:disabled {
                opacity: 0.55;
                cursor: wait;
            }
            .graph-assistant-note-toggle {
                position: fixed;
                width: 42px;
                height: 42px;
                border: none;
                border-radius: 999px;
                background: rgba(255, 255, 255, 0.98);
                color: #102033;
                box-shadow:
                    0 18px 36px rgba(4, 10, 20, 0.32),
                    0 0 0 1px rgba(255, 255, 255, 0.78);
                z-index: calc(var(--graph-assistant-z, 2147483000) + 3);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                pointer-events: auto;
                transition: transform 140ms ease, box-shadow 140ms ease, background 140ms ease;
            }
            .graph-assistant-note-toggle:hover {
                transform: translateY(-1px);
                box-shadow:
                    0 22px 42px rgba(4, 10, 20, 0.38),
                    0 0 0 1px rgba(255, 255, 255, 0.88);
            }
            .graph-assistant-note-toggle[data-active="true"] {
                background: #0f5f8c;
                color: #ffffff;
            }
            .graph-assistant-note-toggle svg {
                width: 18px;
                height: 18px;
            }
            .graph-assistant-note-panel {
                position: fixed;
                left: 16px;
                top: 16px;
                z-index: calc(var(--graph-assistant-z, 2147483000) + 5);
                width: min(360px, calc(100vw - 32px));
                min-height: 280px;
                max-height: min(68vh, 620px);
                display: none;
                box-sizing: border-box;
                border-radius: 18px;
                background: rgba(249, 252, 254, 0.98);
                color: #163345;
                border: 1px solid rgba(15, 95, 140, 0.14);
                box-shadow: 0 22px 52px rgba(5, 10, 20, 0.22);
                overflow: hidden;
            }
            .graph-assistant-note-panel[data-visible="true"] {
                display: flex;
                flex-direction: column;
            }
            .graph-assistant-note-header {
                flex: 0 0 auto;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 14px;
                padding: 13px 14px 12px;
                border-bottom: 1px solid rgba(15, 95, 140, 0.1);
                background: rgba(255, 255, 255, 0.86);
            }
            .graph-assistant-note-heading {
                min-width: 0;
                display: grid;
                gap: 2px;
            }
            .graph-assistant-note-kicker {
                color: #0f5f8c;
                font: 750 10px/1.1 "Inter", "Segoe UI", sans-serif;
                letter-spacing: 0;
                text-transform: uppercase;
            }
            .graph-assistant-note-title {
                color: #102f43;
                font: 760 14px/1.2 "Inter", "Segoe UI", sans-serif;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .graph-assistant-note-status {
                min-height: 16px;
                color: #5b7180;
                font: 600 11.5px/1.35 "Inter", "Segoe UI", sans-serif;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .graph-assistant-note-toolbar {
                flex: 0 0 auto;
                display: inline-flex;
                align-items: center;
                gap: 7px;
            }
            .graph-assistant-note-mic {
                border: none;
                border-radius: 999px;
                min-width: 38px;
                height: 34px;
                padding: 0 12px;
                background: #0f5f8c;
                color: #ffffff;
                font: 750 12px/1 "Inter", "Segoe UI", sans-serif;
                cursor: pointer;
                box-shadow: 0 6px 16px rgba(15, 95, 140, 0.24);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 7px;
                white-space: nowrap;
            }
            .graph-assistant-note-mic svg {
                width: 15px;
                height: 15px;
            }
            .graph-assistant-note-mic[data-active="true"] {
                background: #b53b2c;
                box-shadow: 0 6px 16px rgba(181, 59, 44, 0.32);
            }
            .graph-assistant-note-mic:disabled {
                opacity: 0.7;
                cursor: wait;
            }
            .graph-assistant-note-close {
                width: 34px;
                height: 34px;
                border: none;
                border-radius: 999px;
                background: rgba(15, 95, 140, 0.1);
                color: #0f4f72;
                cursor: pointer;
                font-size: 18px;
                line-height: 1;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }
            .graph-assistant-note-editor {
                flex: 1 1 auto;
                width: 100%;
                min-height: 0;
                box-sizing: border-box;
                padding: 15px 16px 16px;
                background: linear-gradient(180deg, #ffffff 0%, #fbfdfe 100%);
                color: #163345;
                font: 400 14px/1.55 "Inter", "Segoe UI", -apple-system, sans-serif;
                outline: none;
                overflow-y: auto;
                overflow-x: hidden;
                word-wrap: break-word;
            }
            .graph-assistant-note-editor:empty::before {
                content: attr(data-placeholder);
                color: rgba(22, 51, 69, 0.42);
                font-style: italic;
                pointer-events: none;
            }
            .graph-assistant-note-editor:focus {
                box-shadow: inset 0 0 0 2px rgba(15, 95, 140, 0.18);
            }
            .graph-assistant-note-editor h1,
            .graph-assistant-note-editor h2,
            .graph-assistant-note-editor h3,
            .graph-assistant-note-editor h4,
            .graph-assistant-note-editor h5,
            .graph-assistant-note-editor h6 {
                margin: 16px 0 8px;
                line-height: 1.25;
                font-weight: 700;
                color: #0f3a55;
            }
            .graph-assistant-note-editor h1 { font-size: 20px; border-bottom: 1px solid rgba(15, 95, 140, 0.14); padding-bottom: 4px; }
            .graph-assistant-note-editor h2 { font-size: 17px; }
            .graph-assistant-note-editor h3 { font-size: 15px; }
            .graph-assistant-note-editor h4,
            .graph-assistant-note-editor h5,
            .graph-assistant-note-editor h6 { font-size: 14px; }
            .graph-assistant-note-editor > *:first-child { margin-top: 0; }
            .graph-assistant-note-editor p { margin: 8px 0; }
            .graph-assistant-note-editor ul,
            .graph-assistant-note-editor ol { margin: 8px 0; padding-left: 22px; }
            .graph-assistant-note-editor li { margin: 3px 0; }
            .graph-assistant-note-editor li > p { margin: 2px 0; }
            .graph-assistant-note-editor strong { font-weight: 700; color: #0f3a55; }
            .graph-assistant-note-editor em { font-style: italic; }
            .graph-assistant-note-editor code {
                font: 500 12.5px/1.4 "SFMono-Regular", Consolas, Menlo, monospace;
                background: rgba(15, 95, 140, 0.08);
                color: #0f4f72;
                padding: 1px 5px;
                border-radius: 4px;
            }
            .graph-assistant-note-editor pre {
                background: rgba(15, 95, 140, 0.06);
                padding: 10px 12px;
                border-radius: 8px;
                overflow-x: auto;
                margin: 10px 0;
            }
            .graph-assistant-note-editor pre code {
                background: transparent;
                padding: 0;
            }
            .graph-assistant-note-editor blockquote {
                margin: 10px 0;
                padding: 4px 0 4px 12px;
                border-left: 3px solid rgba(15, 95, 140, 0.32);
                color: rgba(22, 51, 69, 0.78);
            }
            .graph-assistant-note-editor a {
                color: #0f5f8c;
                text-decoration: underline;
            }
            .graph-assistant-note-editor hr {
                border: 0;
                border-top: 1px solid rgba(15, 95, 140, 0.14);
                margin: 14px 0;
            }
            .graph-assistant-note-diagnosis {
                flex: 0 0 auto;
                display: grid;
                gap: 10px;
                max-height: min(44%, 300px);
                padding: 12px 16px 14px;
                overflow-y: auto;
                border-top: 1px solid rgba(15, 95, 140, 0.12);
                background: #f7fbfd;
            }
            .graph-assistant-note-fill-summary {
                display: none;
                gap: 8px;
                align-items: start;
                justify-content: space-between;
                padding: 10px 16px;
                border-top: 1px solid rgba(15, 95, 140, 0.12);
                background: #eef8fc;
            }
            .graph-assistant-note-fill-summary[data-visible="true"] {
                display: flex;
            }
            .graph-assistant-note-fill-summary-text {
                min-width: 0;
                color: #123f58;
                font: 650 12px/1.4 "Inter", "Segoe UI", sans-serif;
            }
            .graph-assistant-note-undo {
                flex: 0 0 auto;
                border: 1px solid rgba(15, 95, 140, 0.24);
                border-radius: 999px;
                padding: 7px 11px;
                background: #ffffff;
                color: #0f5f8c;
                font: 750 11.5px/1 "Inter", "Segoe UI", sans-serif;
                cursor: pointer;
                white-space: nowrap;
            }
            .graph-assistant-note-undo:hover:not(:disabled) {
                background: #f6fcff;
                border-color: rgba(15, 95, 140, 0.42);
            }
            .graph-assistant-note-undo:disabled {
                opacity: 0.45;
                cursor: not-allowed;
            }
            .graph-assistant-note-diagnosis-button {
                justify-self: start;
                border: 1px solid rgba(15, 95, 140, 0.22);
                border-radius: 999px;
                padding: 8px 14px;
                background: #ffffff;
                color: #0f5f8c;
                font: 700 12px/1 "Inter", "Segoe UI", sans-serif;
                cursor: pointer;
            }
            .graph-assistant-note-diagnosis-button:hover:not(:disabled) {
                border-color: rgba(15, 95, 140, 0.42);
                background: #eef8fc;
            }
            .graph-assistant-note-diagnosis-button:disabled {
                opacity: 0.55;
                cursor: not-allowed;
            }
            .graph-assistant-note-diagnosis-status {
                display: none;
                color: #526b79;
                font: 600 12px/1.45 "Inter", "Segoe UI", sans-serif;
            }
            .graph-assistant-note-diagnosis-status:not(:empty) {
                display: block;
            }
            .graph-assistant-note-diagnosis-status[data-error="true"] {
                color: #a2352b;
            }
            .graph-assistant-note-diagnosis-notice {
                padding: 9px 10px;
                border-radius: 10px;
                background: #fff8e8;
                color: #745519;
                font: 650 11.5px/1.45 "Inter", "Segoe UI", sans-serif;
            }
            .graph-assistant-note-diagnosis-list {
                display: grid;
                gap: 8px;
            }
            .graph-assistant-note-diagnosis-card {
                padding: 10px 11px;
                border: 1px solid rgba(15, 95, 140, 0.12);
                border-radius: 12px;
                background: #ffffff;
            }
            .graph-assistant-note-diagnosis-card strong {
                display: block;
                color: #123f58;
                font: 750 13px/1.3 "Inter", "Segoe UI", sans-serif;
            }
            .graph-assistant-note-diagnosis-card p {
                margin: 5px 0 0;
                color: #365768;
                font: 400 12px/1.45 "Inter", "Segoe UI", sans-serif;
            }
            .graph-assistant-note-diagnosis-evidence {
                color: #617987 !important;
                font-style: italic !important;
            }
            .graph-assistant-avatar {
                width: var(--graph-assistant-glass-size);
                height: var(--graph-assistant-glass-size);
                border-radius: var(--graph-assistant-glass-radius);
                position: absolute;
                inset: 0;
                overflow: hidden;
                display: flex;
                align-items: center;
                justify-content: center;
                background:
                    linear-gradient(135deg, var(--graph-assistant-glass-highlight) 0%, var(--graph-assistant-glass-mid) 50%, rgba(255, 255, 255, 0.08) 100%);
                backdrop-filter: blur(60px) saturate(180%);
                -webkit-backdrop-filter: blur(60px) saturate(180%);
                border: 0.5px solid var(--graph-assistant-glass-border);
                box-shadow: 0 15px 50px var(--graph-assistant-glass-shadow);
                transition: transform 180ms ease;
                pointer-events: auto;
                cursor: grab;
                touch-action: none;
                user-select: none;
                -webkit-user-select: none;
                outline: none;
            }
            .graph-assistant-avatar:focus-visible {
                box-shadow:
                    0 15px 50px var(--graph-assistant-glass-shadow),
                    0 0 0 4px rgba(15, 95, 140, 0.22);
            }
            .graph-assistant-shell[data-dragging="true"] .graph-assistant-avatar {
                cursor: grabbing;
            }
            .graph-assistant-label {
                display: none;
            }
            .graph-assistant-state-label {
                position: absolute;
                left: 50%;
                bottom: -10px;
                transform: translateX(-50%) translateY(4px);
                min-width: 86px;
                max-width: 138px;
                padding: 5px 9px;
                border-radius: 999px;
                background: rgba(13, 22, 30, 0.88);
                color: #ffffff;
                box-shadow: 0 10px 26px rgba(0, 0, 0, 0.22);
                font: 750 10.5px/1.1 "Inter", "Segoe UI", sans-serif;
                text-align: center;
                opacity: 0;
                pointer-events: none;
                transition: opacity 160ms ease, transform 160ms ease;
            }
            .graph-assistant-state-label[data-visible="true"] {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }
            .graph-assistant-face-frame {
                position: absolute;
                inset: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                pointer-events: none;
            }
            .graph-assistant-face-slot {
                position: absolute;
                z-index: 2;
                inset: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                pointer-events: none;
            }
            .graph-assistant-face-core {
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                pointer-events: none;
            }
            .graph-assistant-face-svg {
                position: absolute;
                left: 50%;
                top: 50%;
                width: 112px;
                height: 112px;
                transform: translate(-50%, -50%);
                z-index: 2;
                overflow: hidden;
                display: block;
                margin: 0;
                pointer-events: none;
            }
            .graph-assistant-face-stroke {
                fill: none;
                stroke: var(--graph-assistant-face-tint);
                stroke-width: 3;
                stroke-linecap: round;
                stroke-linejoin: round;
                opacity: 1;
                transition: transform 180ms ease, opacity 180ms ease;
                filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.28));
            }
            .graph-assistant-spotlight {
                position: fixed;
                border-radius: 18px;
                border: 2px solid rgba(15, 95, 140, 0.84);
                box-shadow: 0 0 0 9999px rgba(15, 19, 25, 0.18), 0 0 0 8px rgba(15, 95, 140, 0.12);
                pointer-events: none;
                opacity: 0;
                transition: opacity 180ms ease, left 280ms ease, top 280ms ease, width 280ms ease, height 280ms ease;
                z-index: calc(var(--graph-assistant-z, 2147483000) - 1);
            }
            .graph-assistant-spotlight[data-visible="true"] {
                opacity: 1;
            }
            @keyframes graphAssistantGlassFloat {
                0%, 100% {
                    transform: translateY(0);
                }
                50% {
                    transform: translateY(-2px);
                }
            }
            @keyframes graphAssistantActivePulse {
                0%, 100% {
                    transform: scale(0.98);
                    opacity: 0.28;
                }
                50% {
                    transform: scale(1.08);
                    opacity: 0.78;
                }
            }
            @media (prefers-reduced-motion: reduce) {
                .graph-assistant-shell[data-has-activity="true"] .graph-assistant-avatar::before {
                    animation: none;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function ensureElements() {
        let shell = document.getElementById('graph-assistant-shell');
        if (!shell) {
            shell = document.createElement('div');
            shell.id = 'graph-assistant-shell';
            shell.className = 'graph-assistant-shell';
            shell.dataset.state = 'idle';
            setElementHtml(shell, `
                <div class="graph-assistant-avatar" role="button" tabindex="0" aria-label="Abrir Miracle" aria-expanded="false" aria-controls="graph-assistant-bubble graph-assistant-chat-composer graph-assistant-note-panel">
                    <div class="graph-assistant-face-frame">
                        <div class="graph-assistant-face-slot" data-face-slot="true">
                            <div class="graph-assistant-face-core">
                                <svg class="graph-assistant-face-svg" viewBox="-75 -75 150 150" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                                    <g id="graph-assistant-face-group" transform="rotate(-2)">
                                        <path id="graph-assistant-left-eyebrow" class="graph-assistant-face-stroke"></path>
                                        <path id="graph-assistant-right-eyebrow" class="graph-assistant-face-stroke"></path>
                                        <path id="graph-assistant-left-eye-line" class="graph-assistant-face-stroke"></path>
                                        <path id="graph-assistant-right-eye-line" class="graph-assistant-face-stroke"></path>
                                        <path id="graph-assistant-mouth" class="graph-assistant-face-stroke"></path>
                                    </g>
                                </svg>
                            </div>
                        </div>
                    </div>
                    <div class="graph-assistant-label" id="graph-assistant-label">Miracle</div>
                </div>
                <div class="graph-assistant-state-label" id="graph-assistant-state-label" data-visible="false"></div>
            `);
            document.body.appendChild(shell);
        }

        let bubble = document.getElementById('graph-assistant-bubble');
        if (!bubble) {
            bubble = document.createElement('div');
            bubble.id = 'graph-assistant-bubble';
            bubble.className = 'graph-assistant-bubble';
            bubble.dataset.visible = 'true';
            setElementHtml(bubble, '<span class="graph-assistant-bubble-text" id="graph-assistant-bubble-text"></span>');
            document.body.appendChild(bubble);
        }

        let userBubble = document.getElementById('graph-assistant-user-bubble');
        if (!userBubble) {
            userBubble = document.createElement('div');
            userBubble.id = 'graph-assistant-user-bubble';
            userBubble.className = 'graph-assistant-user-bubble';
            userBubble.dataset.visible = 'false';
            document.body.appendChild(userBubble);
        }

        let chatButton = document.getElementById('graph-assistant-chat-toggle');
        if (!chatButton) {
            chatButton = document.createElement('button');
            chatButton.id = 'graph-assistant-chat-toggle';
            chatButton.className = 'graph-assistant-chat-toggle';
            chatButton.type = 'button';
            chatButton.dataset.active = 'false';
            chatButton.setAttribute('aria-label', 'Abrir chat del asistente');
            chatButton.title = 'Abrir chat';
            setElementHtml(chatButton, '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v10H8.5L4 19V5Z" fill="currentColor"/></svg>');
            document.body.appendChild(chatButton);
        }

        let chatComposer = document.getElementById('graph-assistant-chat-composer');
        if (!chatComposer) {
            chatComposer = document.createElement('div');
            chatComposer.id = 'graph-assistant-chat-composer';
            chatComposer.className = 'graph-assistant-chat-composer';
            chatComposer.dataset.visible = 'false';
            setElementHtml(chatComposer, `
                <textarea id="graph-assistant-chat-input" rows="2" placeholder="Escribe tu mensaje..."></textarea>
                <div class="graph-assistant-chat-composer-actions">
                    <button id="graph-assistant-chat-send" class="graph-assistant-chat-send" type="button" aria-label="Enviar mensaje">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 20.5 4l-4.7 16-3.8-5-5-3.5Z" fill="currentColor"/></svg>
                    </button>
                </div>
            `);
            document.body.appendChild(chatComposer);
        }

        let noteButton = document.getElementById('graph-assistant-note-toggle');
        if (!noteButton) {
            noteButton = document.createElement('button');
            noteButton.id = 'graph-assistant-note-toggle';
            noteButton.className = 'graph-assistant-note-toggle';
            noteButton.type = 'button';
            noteButton.dataset.active = 'false';
            noteButton.setAttribute('aria-label', 'Abrir hoja de notas');
            noteButton.title = 'Abrir hoja de notas';
            setElementHtml(noteButton, '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm6 1.5V9h4.5M9 13h6M9 16h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>');
            document.body.appendChild(noteButton);
        }

        let notePanel = document.getElementById('graph-assistant-note-panel');
        if (!notePanel) {
            notePanel = document.createElement('div');
            notePanel.id = 'graph-assistant-note-panel';
            notePanel.className = 'graph-assistant-note-panel';
            notePanel.dataset.visible = 'false';
            setElementHtml(notePanel, `
                <div class="graph-assistant-note-header">
                    <div class="graph-assistant-note-heading">
                        <span class="graph-assistant-note-kicker">Miracle</span>
                        <strong id="graph-assistant-note-title" class="graph-assistant-note-title">Nota clinica</strong>
                        <span id="graph-assistant-note-status" class="graph-assistant-note-status">Lista para dictado.</span>
                    </div>
                    <div class="graph-assistant-note-toolbar">
                        <button id="graph-assistant-note-mic" class="graph-assistant-note-mic" type="button" data-active="false" aria-label="Grabar nota">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.92V21h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.08A7 7 0 0 1 5 12a1 1 0 1 1 2 0 5 5 0 1 0 10 0Z" fill="currentColor"/></svg>
                            <span id="graph-assistant-note-mic-label">Grabar</span>
                        </button>
                        <button id="graph-assistant-note-close" class="graph-assistant-note-close" type="button" aria-label="Cerrar hoja">x</button>
                    </div>
                </div>
                <div id="graph-assistant-note-editor" class="graph-assistant-note-editor" contenteditable="true" spellcheck="false" data-placeholder="Dicta con Miracle o escribe aqui directamente." role="textbox" aria-multiline="true"></div>
                <div id="graph-assistant-note-fill-summary" class="graph-assistant-note-fill-summary" data-visible="false" role="status" aria-live="polite">
                    <div id="graph-assistant-note-fill-summary-text" class="graph-assistant-note-fill-summary-text"></div>
                    <button id="graph-assistant-note-undo" class="graph-assistant-note-undo" type="button" disabled>Deshacer llenado</button>
                </div>
                <section class="graph-assistant-note-diagnosis" aria-label="Sugerencias diagnosticas">
                    <button id="graph-assistant-note-diagnosis-button" class="graph-assistant-note-diagnosis-button" type="button" disabled>Sugerir diagnosticos</button>
                    <div id="graph-assistant-note-diagnosis-status" class="graph-assistant-note-diagnosis-status" role="status" aria-live="polite"></div>
                    <div id="graph-assistant-note-diagnosis-notice" class="graph-assistant-note-diagnosis-notice" hidden></div>
                    <div id="graph-assistant-note-diagnosis-list" class="graph-assistant-note-diagnosis-list"></div>
                </section>
            `);
            document.body.appendChild(notePanel);
        }

        let spotlight = document.getElementById('graph-assistant-spotlight');
        if (!spotlight) {
            spotlight = document.createElement('div');
            spotlight.id = 'graph-assistant-spotlight';
            spotlight.className = 'graph-assistant-spotlight';
            document.body.appendChild(spotlight);
        }

        return {
            shell,
            avatar: shell.querySelector('.graph-assistant-avatar'),
            bubble,
            bubbleText: document.getElementById('graph-assistant-bubble-text'),
            userBubble,
            chatButton,
            noteButton,
            chatComposer,
            chatInput: document.getElementById('graph-assistant-chat-input'),
            chatSendButton: document.getElementById('graph-assistant-chat-send'),
            notePanel,
            notePanelClose: document.getElementById('graph-assistant-note-close'),
            notePanelMic: document.getElementById('graph-assistant-note-mic'),
            notePanelMicLabel: document.getElementById('graph-assistant-note-mic-label'),
            notePanelTitle: document.getElementById('graph-assistant-note-title'),
            notePanelStatus: document.getElementById('graph-assistant-note-status'),
            notePanelEditor: document.getElementById('graph-assistant-note-editor'),
            noteFillSummary: document.getElementById('graph-assistant-note-fill-summary'),
            noteFillSummaryText: document.getElementById('graph-assistant-note-fill-summary-text'),
            noteUndoButton: document.getElementById('graph-assistant-note-undo'),
            noteDiagnosisButton: document.getElementById('graph-assistant-note-diagnosis-button'),
            noteDiagnosisStatus: document.getElementById('graph-assistant-note-diagnosis-status'),
            noteDiagnosisNotice: document.getElementById('graph-assistant-note-diagnosis-notice'),
            noteDiagnosisList: document.getElementById('graph-assistant-note-diagnosis-list'),
            label: document.getElementById('graph-assistant-label'),
            stateLabel: document.getElementById('graph-assistant-state-label'),
            spotlight
        };
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function getActiveActivityKeys() {
        return Object.keys(state.activity).filter((key) => Boolean(state.activity[key]));
    }

    function getActivityLabel() {
        const labels = getActiveActivityKeys()
            .map((key) => ACTIVITY_LABELS[key])
            .filter(Boolean);
        return labels.length ? `Miracle activo: ${labels.join(', ')}` : '';
    }

    function syncExpandedAttributes() {
        const { shell, avatar, stateLabel } = ensureElements();
        const expanded = state.ui.expanded;
        const activeKeys = getActiveActivityKeys();
        const activityLabel = getActivityLabel();
        document.body.dataset.assistantExpanded = expanded ? 'true' : 'false';
        shell.dataset.expanded = expanded ? 'true' : 'false';
        shell.dataset.hasActivity = activeKeys.length ? 'true' : 'false';
        shell.dataset.activity = activeKeys.join(' ');
        if (avatar) {
            avatar.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            avatar.setAttribute('aria-label', expanded
                ? 'Ocultar Miracle'
                : (activityLabel ? `Abrir Miracle. ${activityLabel}` : 'Abrir Miracle'));
            avatar.title = expanded ? 'Ocultar Miracle' : 'Abrir Miracle';
        }
        if (stateLabel) {
            const modeLabel = MODE_LABELS[state.face.mode] || '';
            stateLabel.textContent = modeLabel;
            stateLabel.dataset.visible = modeLabel ? 'true' : 'false';
        }
        const notePanel = document.getElementById('graph-assistant-note-panel');
        if (notePanel) {
            notePanel.setAttribute('aria-hidden', state.note.open && expanded ? 'false' : 'true');
        }
    }

    function setAssistantExpanded(expanded, options = {}) {
        const nextExpanded = Boolean(expanded);
        const changed = state.ui.expanded !== nextExpanded;
        state.ui.expanded = nextExpanded;
        syncExpandedAttributes();
        if (nextExpanded) {
            window.requestAnimationFrame(positionBubbleNearShell);
        }
        if (changed && options.emit !== false) {
            emit('expanded-change', {
                expanded: nextExpanded,
                source: options.source || 'api'
            });
        }
    }

    function setActivityIndicators(indicators = {}) {
        Object.keys(state.activity).forEach((key) => {
            if (indicators[key] !== undefined) {
                state.activity[key] = Boolean(indicators[key]);
            }
        });
        syncExpandedAttributes();
    }

    function setShellPosition(x, y) {
        const { shell } = ensureElements();
        const padding = 28;
        const rect = shell.getBoundingClientRect();
        const shellWidth = Math.max(rect.width, 112);
        const shellHeight = Math.max(rect.height, 112);
        const left = clamp(x - shellWidth / 2, padding, window.innerWidth - padding - shellWidth);
        const top = clamp(y - shellHeight / 2, padding, window.innerHeight - padding - shellHeight);
        shell.style.left = `${left}px`;
        shell.style.top = `${top}px`;
        updateFaceDirectionFromShell();
        updateFaceTintFromBackdrop();
        positionBubbleNearShell();
        window.setTimeout(positionBubbleNearShell, 360);
    }

    function parseCssColor(colorText) {
        if (!colorText || colorText === 'transparent') {
            return null;
        }

        const rgbMatch = colorText.match(/rgba?\(([^)]+)\)/i);
        if (rgbMatch) {
            const parts = rgbMatch[1].split(',').map((value) => Number.parseFloat(value.trim()));
            if (parts.length >= 3) {
                return {
                    r: parts[0],
                    g: parts[1],
                    b: parts[2],
                    a: Number.isFinite(parts[3]) ? parts[3] : 1
                };
            }
        }

        const hex = colorText.replace('#', '').trim();
        if (hex.length === 3) {
            return {
                r: Number.parseInt(hex[0] + hex[0], 16),
                g: Number.parseInt(hex[1] + hex[1], 16),
                b: Number.parseInt(hex[2] + hex[2], 16),
                a: 1
            };
        }
        if (hex.length === 6) {
            return {
                r: Number.parseInt(hex.slice(0, 2), 16),
                g: Number.parseInt(hex.slice(2, 4), 16),
                b: Number.parseInt(hex.slice(4, 6), 16),
                a: 1
            };
        }

        return null;
    }

    function isRuntimeOwnedElement(element) {
        return Boolean(
            element?.closest?.('#graph-assistant-shell')
            || element?.closest?.('#graph-assistant-bubble')
            || element?.closest?.('#graph-assistant-chat-toggle')
            || element?.closest?.('#graph-assistant-note-toggle')
            || element?.closest?.('#graph-assistant-chat-composer')
            || element?.closest?.('#graph-assistant-note-panel')
            || element?.closest?.('#graph-assistant-spotlight')
        );
    }

    function resolveBackgroundColorFromElement(element) {
        let current = element;
        while (current && current !== document.documentElement) {
            const computed = window.getComputedStyle(current);
            const parsed = parseCssColor(computed.backgroundColor);
            if (parsed && parsed.a > 0.08) {
                return parsed;
            }
            current = current.parentElement;
        }

        const bodyColor = parseCssColor(window.getComputedStyle(document.body).backgroundColor);
        return bodyColor || { r: 255, g: 255, b: 255, a: 1 };
    }

    function relativeLuminance(color) {
        const normalizeChannel = (value) => {
            const channel = value / 255;
            return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        };

        const r = normalizeChannel(color.r || 0);
        const g = normalizeChannel(color.g || 0);
        const b = normalizeChannel(color.b || 0);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    function updateFaceTintFromBackdrop() {
        const { shell } = ensureElements();
        const rect = shell.getBoundingClientRect();
        const samplePoints = [
            { x: rect.left + rect.width * 0.18, y: rect.top + rect.height * 0.18 },
            { x: rect.left + rect.width * 0.82, y: rect.top + rect.height * 0.18 },
            { x: rect.left + rect.width * 0.18, y: rect.top + rect.height * 0.82 },
            { x: rect.left + rect.width * 0.82, y: rect.top + rect.height * 0.82 },
            { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 }
        ];

        const luminances = samplePoints.map((point) => {
            const sampleX = clamp(point.x, 1, window.innerWidth - 1);
            const sampleY = clamp(point.y, 1, window.innerHeight - 1);
            const stack = typeof document.elementsFromPoint === 'function'
                ? document.elementsFromPoint(sampleX, sampleY)
                : [];
            const target = stack.find((element) => !isRuntimeOwnedElement(element)) || document.body;
            return relativeLuminance(resolveBackgroundColorFromElement(target));
        });

        const darkest = Math.min(...luminances);
        const average = luminances.reduce((sum, value) => sum + value, 0) / Math.max(1, luminances.length);
        const faceTint = (darkest < 0.42 || average < 0.5) ? '#ffffff' : '#111111';
        document.documentElement.style.setProperty('--graph-assistant-face-tint', faceTint);
    }

    function setDragging(active) {
        const { shell } = ensureElements();
        state.dragging.active = active;
        shell.dataset.dragging = active ? 'true' : 'false';
    }

    function stopTypingAnimation() {
        if (state.speech.typingTimer) {
            clearTimeout(state.speech.typingTimer);
            state.speech.typingTimer = null;
        }
    }

    function renderBubbleText(text) {
        const { bubble, bubbleText } = ensureElements();
        if (!bubble || !bubbleText) return;
        bubbleText.textContent = text || '';
        bubble.dataset.visible = text ? 'true' : 'false';
        window.requestAnimationFrame(positionBubbleNearShell);
    }

    function renderUserBubbleText(text) {
        const { userBubble } = ensureElements();
        if (!userBubble) return;
        userBubble.textContent = text || '';
        userBubble.dataset.visible = text ? 'true' : 'false';
        window.requestAnimationFrame(positionBubbleNearShell);
    }

    function setChatComposerVisible(visible, options = {}) {
        const { chatComposer, chatButton, chatInput } = ensureElements();
        if (!chatComposer || !chatButton) {
            return;
        }
        state.chat.open = Boolean(visible);
        chatComposer.dataset.visible = visible ? 'true' : 'false';
        chatButton.dataset.active = visible ? 'true' : 'false';
        positionBubbleNearShell();
        if (visible && options.focus !== false) {
            window.setTimeout(() => {
                chatInput?.focus();
            }, 20);
        }
    }

    function submitChatComposer() {
        const { chatInput, chatSendButton } = ensureElements();
        const message = `${chatInput?.value || ''}`.trim();
        if (!message || !chatSendButton || chatSendButton.disabled) {
            return;
        }
        emit('chat-submit', { message });
    }

    function bindDragHandlers() {
        const { avatar } = ensureElements();
        if (!avatar || avatar.dataset.dragBound === 'true') {
            return;
        }

        avatar.dataset.dragBound = 'true';

        avatar.addEventListener('pointerdown', (event) => {
            const { shell } = ensureElements();
            const rect = shell.getBoundingClientRect();

            state.pinned = false;
            api.clearSpotlight();
            state.interaction.lastTouchAt = Date.now();
            emit('touched', { type: 'pointerdown' });
            state.dragging.pointerId = event.pointerId;
            state.dragging.startX = event.clientX;
            state.dragging.startY = event.clientY;
            state.dragging.moved = false;
            state.dragging.offsetX = event.clientX - rect.left;
            state.dragging.offsetY = event.clientY - rect.top;
            setDragging(true);

            if (typeof avatar.setPointerCapture === 'function') {
                avatar.setPointerCapture(event.pointerId);
            }
        });

        avatar.addEventListener('pointermove', (event) => {
            if (!state.dragging.active || state.dragging.pointerId !== event.pointerId) {
                return;
            }

            api.clearSpotlight();
            const moveDistance = Math.hypot(event.clientX - state.dragging.startX, event.clientY - state.dragging.startY);
            if (moveDistance > 5) {
                state.dragging.moved = true;
            }
            const { shell } = ensureElements();
            const rect = shell.getBoundingClientRect();
            const nextLeft = event.clientX - state.dragging.offsetX;
            const nextTop = event.clientY - state.dragging.offsetY;
            const centerX = nextLeft + rect.width / 2;
            const centerY = nextTop + rect.height / 2;
            setShellPosition(centerX, centerY);
        });

        const releaseDrag = (event) => {
            if (state.dragging.pointerId !== null && event.pointerId !== state.dragging.pointerId) {
                return;
            }

            state.dragging.pointerId = null;
            setDragging(false);

            if (typeof avatar.releasePointerCapture === 'function' && event.pointerId !== undefined) {
                try {
                    avatar.releasePointerCapture(event.pointerId);
                } catch (error) {
                    // Ignore release errors when pointer capture is already cleared.
                }
            }
        };

        avatar.addEventListener('pointerup', releaseDrag);
        avatar.addEventListener('pointercancel', releaseDrag);
        avatar.addEventListener('click', (event) => {
            if (state.dragging.moved) {
                event.preventDefault();
                state.dragging.moved = false;
                return;
            }
            api.toggleExpanded({ source: 'avatar' });
        });
        avatar.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') {
                return;
            }
            event.preventDefault();
            state.interaction.lastTouchAt = Date.now();
            emit('touched', { type: 'keyboard' });
            api.toggleExpanded({ source: 'keyboard' });
        });
    }

    function pinShellBottomRight() {
        const { shell } = ensureElements();
        const padding = 28;
        const rect = shell.getBoundingClientRect();
        const targetX = window.innerWidth - padding - Math.max(rect.width / 2, 56);
        const targetY = window.innerHeight - padding - Math.max(rect.height / 2, 56);
        state.pinned = true;
        setShellPosition(targetX, targetY);
    }

    function unpinShell() {
        state.pinned = false;
    }

    function positionNearRect(rect) {
        const shell = ensureElements().shell;
        const shellRect = shell.getBoundingClientRect();
        const horizontalGap = 34;
        const verticalGap = 18;
        const preferredRightX = rect.right + horizontalGap + shellRect.width / 2;
        const preferredLeftX = rect.left - horizontalGap - shellRect.width / 2;
        const centeredY = rect.top + Math.min(rect.height / 2, 70);

        const hasRoomOnRight = rect.right + horizontalGap + shellRect.width < window.innerWidth - 24;
        const hasRoomOnLeft = rect.left - horizontalGap - shellRect.width > 24;

        const x = hasRoomOnRight
            ? preferredRightX
            : hasRoomOnLeft
                ? preferredLeftX
                : rect.left + rect.width / 2;

        const y = centeredY + verticalGap;
        setShellPosition(x, y);
    }

    function resolveElement(selector) {
        if (!selector) return null;
        try {
            return document.querySelector(selector);
        } catch (error) {
            return null;
        }
    }

    function showBubble(text) {
        const finalText = `${text || ''}`;
        stopTypingAnimation();
        state.speech.targetText = finalText;
        state.speech.displayedText = '';

        if (!finalText) {
            renderBubbleText('');
            return;
        }

        const typeNextChunk = () => {
            const remaining = state.speech.targetText.slice(state.speech.displayedText.length);
            if (!remaining) {
                state.speech.typingTimer = null;
                return;
            }

            const nextChunkLength = remaining.length > 42 ? 4 : remaining.length > 18 ? 3 : 2;
            state.speech.displayedText += remaining.slice(0, nextChunkLength);
            renderBubbleText(state.speech.displayedText);
            state.speech.typingTimer = setTimeout(typeNextChunk, 12);
        };

        renderBubbleText('');
        typeNextChunk();
    }

    function getSpeechSynthesis() {
        if (typeof window === 'undefined' || !window.speechSynthesis || typeof window.SpeechSynthesisUtterance === 'undefined') {
            return null;
        }
        return window.speechSynthesis;
    }

    function pickSpanishVoice() {
        const synth = getSpeechSynthesis();
        if (!synth) {
            return null;
        }

        const voices = synth.getVoices();
        if (!voices.length) {
            return null;
        }

        const preferredLocales = ['es-CO', 'es-MX', 'es-US', 'es-419', 'es-ES'];
        for (const locale of preferredLocales) {
            const exact = voices.find((voice) => `${voice.lang || ''}`.toLowerCase() === locale.toLowerCase());
            if (exact) {
                return exact;
            }
        }

        return voices.find((voice) => `${voice.lang || ''}`.toLowerCase().startsWith('es')) || null;
    }

    function stopAudibleSpeech() {
        const synth = getSpeechSynthesis();
        if (!synth) {
            return;
        }
        if (state.speech.currentUtterance) {
            state.speech.currentUtterance.onend = null;
            state.speech.currentUtterance.onerror = null;
            state.speech.currentUtterance = null;
        }
        if (synth.speaking || synth.pending) {
            synth.cancel();
        }
    }

    function speakAudibly(text, options = {}) {
        const synth = getSpeechSynthesis();
        const normalizedText = `${text || ''}`.trim();
        if (!synth || !normalizedText) {
            return;
        }

        stopAudibleSpeech();

        const utterance = new window.SpeechSynthesisUtterance(normalizedText);
        state.speech.selectedVoice = state.speech.selectedVoice || pickSpanishVoice();
        if (state.speech.selectedVoice) {
            utterance.voice = state.speech.selectedVoice;
            utterance.lang = state.speech.selectedVoice.lang || 'es-CO';
        } else {
            utterance.lang = 'es-CO';
        }
        utterance.rate = Number(options.rate || 1);
        utterance.pitch = Number(options.pitch || 1);
        utterance.volume = Number(options.volume || 1);
        utterance.onend = () => {
            if (state.speech.currentUtterance === utterance) {
                state.speech.currentUtterance = null;
            }
        };
        utterance.onerror = () => {
            if (state.speech.currentUtterance === utterance) {
                state.speech.currentUtterance = null;
            }
        };
        state.speech.currentUtterance = utterance;
        synth.speak(utterance);
    }

    function positionBubbleNearShell() {
        const shell = document.getElementById('graph-assistant-shell');
        const bubble = document.getElementById('graph-assistant-bubble');
        const userBubble = document.getElementById('graph-assistant-user-bubble');
        const chatButton = document.getElementById('graph-assistant-chat-toggle');
        const noteButton = document.getElementById('graph-assistant-note-toggle');
        const chatComposer = document.getElementById('graph-assistant-chat-composer');
        const notePanel = document.getElementById('graph-assistant-note-panel');
        if (!shell || !bubble) {
            return;
        }

        const shellRect = shell.getBoundingClientRect();
        const bubbleRect = bubble.getBoundingClientRect();
        const gap = 18;
        const padding = 16;
        const preferredLeft = shellRect.left - bubbleRect.width - gap;
        const fallbackLeft = shellRect.right + gap;
        const hasRoomOnLeft = preferredLeft >= padding;
        const rawLeft = hasRoomOnLeft ? preferredLeft : fallbackLeft;
        const rawTop = shellRect.top + (shellRect.height - bubbleRect.height) / 2;
        const maxLeft = window.innerWidth - bubbleRect.width - padding;
        const maxTop = window.innerHeight - bubbleRect.height - padding;

        const buttonSize = 42;
        const buttonGap = 10;
        const controlsWidth = (buttonSize * 2) + buttonGap;
        const controlsLeft = clamp(
            rawLeft + (bubbleRect.width / 2) - (controlsWidth / 2),
            padding,
            window.innerWidth - controlsWidth - padding
        );
        const controlsTop = clamp(rawTop + bubbleRect.height + 10, padding, window.innerHeight - buttonSize - padding);

        let currentBottom = controlsTop - 12;

        if (chatComposer && chatComposer.dataset.visible === 'true') {
            const composerRect = chatComposer.getBoundingClientRect();
            const composerWidth = Math.max(composerRect.width, 120);
            const composerHeight = Math.max(composerRect.height, 42);
            const composerLeft = clamp(rawLeft, padding, Math.max(padding, window.innerWidth - composerWidth - padding));
            const composerTop = clamp(currentBottom - composerHeight, padding, Math.max(padding, window.innerHeight - composerHeight - padding));
            chatComposer.style.left = `${composerLeft}px`;
            chatComposer.style.top = `${composerTop}px`;
            currentBottom = composerTop - 12;
        }

        const messageItems = [];
        if (bubble.dataset.visible === 'true') {
            messageItems.push(bubble);
        }
        if (userBubble && userBubble.dataset.visible === 'true') {
            messageItems.push(userBubble);
        }

        messageItems.forEach((item) => {
            const itemRect = item.getBoundingClientRect();
            const itemWidth = Math.max(itemRect.width, 120);
            const itemHeight = Math.max(itemRect.height, 42);
            const itemLeft = clamp(rawLeft, padding, Math.max(padding, window.innerWidth - itemWidth - padding));
            const itemTop = clamp(currentBottom - itemHeight, padding, Math.max(padding, window.innerHeight - itemHeight - padding));
            item.style.left = `${itemLeft}px`;
            item.style.top = `${itemTop}px`;
            currentBottom = itemTop - 12;
        });

        if (bubble.dataset.visible !== 'true') {
            bubble.style.left = `${clamp(rawLeft, padding, Math.max(padding, maxLeft))}px`;
            bubble.style.top = `${clamp(rawTop, padding, Math.max(padding, maxTop))}px`;
        }

        if (chatButton) {
            chatButton.style.left = `${controlsLeft}px`;
            chatButton.style.top = `${controlsTop}px`;
        }
        if (noteButton) {
            noteButton.style.left = `${controlsLeft + buttonSize + buttonGap}px`;
            noteButton.style.top = `${controlsTop}px`;
        }
        if (notePanel && notePanel.dataset.visible === 'true') {
            const noteRect = notePanel.getBoundingClientRect();
            const noteWidth = Math.max(noteRect.width, 240);
            const noteHeight = Math.max(noteRect.height, 280);
            const noteLeft = clamp(rawLeft, padding, Math.max(padding, window.innerWidth - noteWidth - padding));
            const noteTop = clamp(currentBottom - noteHeight, padding, Math.max(padding, window.innerHeight - noteHeight - padding));
            notePanel.style.left = `${noteLeft}px`;
            notePanel.style.top = `${noteTop}px`;
        }
    }

    function setMode(mode) {
        const { shell } = ensureElements();
        shell.dataset.state = mode || 'idle';
        state.face.mode = mode || 'idle';
        renderAssistantFace();
        syncExpandedAttributes();
    }

    function updateSpotlightForElement(element) {
        const { spotlight } = ensureElements();
        if (!element) {
            spotlight.dataset.visible = 'false';
            return;
        }

        const rect = element.getBoundingClientRect();
        const pad = 10;
        spotlight.style.left = `${Math.max(0, rect.left - pad)}px`;
        spotlight.style.top = `${Math.max(0, rect.top - pad)}px`;
        spotlight.style.width = `${Math.min(window.innerWidth, rect.width + pad * 2)}px`;
        spotlight.style.height = `${Math.min(window.innerHeight, rect.height + pad * 2)}px`;
        spotlight.dataset.visible = 'true';
    }

    function emit(eventName, payload) {
        const handlers = state.listeners.get(eventName) || [];
        handlers.forEach((handler) => {
            try {
                handler(payload);
            } catch (error) {
                console.warn('[GraphAssistantRuntime] listener error', error);
            }
        });
    }

    const api = {
        mount(config = {}) {
            const firstMount = !state.mounted;
            state.options = { ...DEFAULTS, ...config };
            ensureStyles();
            const {
                label,
                chatButton,
                noteButton,
                notePanelClose,
                notePanelMic,
                noteUndoButton,
                noteDiagnosisButton,
                chatInput,
                chatSendButton
            } = ensureElements();
            bindDragHandlers();
            document.documentElement.style.setProperty('--graph-assistant-accent', state.options.accentColor);
            document.documentElement.style.setProperty('--graph-assistant-z', `${state.options.zIndex}`);
            if (label) {
                label.textContent = state.options.name || 'Miracle';
            }
            if (!state.ui.escapeBound) {
                state.ui.escapeBound = true;
                window.addEventListener('keydown', (event) => {
                    if (event.key === 'Escape' && state.ui.expanded) {
                        setAssistantExpanded(false, { source: 'escape' });
                    }
                });
            }
            if (chatButton && chatButton.dataset.bound !== 'true') {
                chatButton.dataset.bound = 'true';
                chatButton.addEventListener('click', () => {
                    setAssistantExpanded(true, { source: 'chat-toggle' });
                    setChatComposerVisible(!state.chat.open, { focus: true });
                    emit('chat-toggle', { open: state.chat.open });
                });
            }
            if (noteButton && noteButton.dataset.bound !== 'true') {
                noteButton.dataset.bound = 'true';
                noteButton.addEventListener('click', () => {
                    setAssistantExpanded(true, { source: 'note-toggle' });
                    api.setNotePanelState({ visible: !state.note.open });
                    emit('note-toggle', { open: state.note.open });
                });
            }
            if (notePanelClose && notePanelClose.dataset.bound !== 'true') {
                notePanelClose.dataset.bound = 'true';
                notePanelClose.addEventListener('click', () => {
                    api.setNotePanelState({ visible: false });
                    emit('note-toggle', { open: false });
                    setAssistantExpanded(false, { source: 'note-close' });
                });
            }
            if (notePanelMic && notePanelMic.dataset.bound !== 'true') {
                notePanelMic.dataset.bound = 'true';
                notePanelMic.addEventListener('click', () => emit('note-mic-button', {}));
            }
            if (noteUndoButton && noteUndoButton.dataset.bound !== 'true') {
                noteUndoButton.dataset.bound = 'true';
                noteUndoButton.addEventListener('click', () => emit('note-undo-fill', {}));
            }
            if (noteDiagnosisButton && noteDiagnosisButton.dataset.bound !== 'true') {
                noteDiagnosisButton.dataset.bound = 'true';
                noteDiagnosisButton.addEventListener('click', () => emit('note-diagnosis-button', {}));
            }
            if (chatSendButton && chatSendButton.dataset.bound !== 'true') {
                chatSendButton.dataset.bound = 'true';
                chatSendButton.addEventListener('click', submitChatComposer);
            }
            if (chatInput && chatInput.dataset.bound !== 'true') {
                chatInput.dataset.bound = 'true';
                chatInput.addEventListener('keydown', (event) => {
                    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
                        return;
                    }
                    event.preventDefault();
                    submitChatComposer();
                });
            }
            showBubble(state.options.idleMessage || DEFAULTS.idleMessage);
            setShellPosition(window.innerWidth - 96, window.innerHeight - 164);
            state.mounted = true;
            if (firstMount) {
                setAssistantExpanded(Boolean(config.expanded), { emit: false, source: 'mount' });
            } else {
                syncExpandedAttributes();
            }
            setMode('idle');
            ensureFaceAnimation();
            emit('mounted', { options: state.options });
        },
        setExpanded(expanded, options = {}) {
            if (!state.mounted) {
                api.mount();
            }
            setAssistantExpanded(expanded, options);
        },
        toggleExpanded(options = {}) {
            if (!state.mounted) {
                api.mount();
            }
            setAssistantExpanded(!state.ui.expanded, options);
        },
        isExpanded() {
            return Boolean(state.ui.expanded);
        },
        setActivityIndicators(indicators = {}) {
            if (!state.mounted) {
                api.mount();
            }
            setActivityIndicators(indicators);
        },
        speak(text, options = {}) {
            if (!state.mounted) {
                api.mount();
            }
            showBubble(text || '');
            if (options.mode) {
                setMode(options.mode);
            }
            if (options.audible) {
                speakAudibly(text, options);
            }
        },
        clearSpeech() {
            showBubble('');
            stopAudibleSpeech();
        },
        showUserSpeech(text) {
            renderUserBubbleText(text || '');
        },
        clearUserSpeech() {
            renderUserBubbleText('');
        },
        openChatComposer(config = {}) {
            if (!state.mounted) {
                api.mount();
            }
            setAssistantExpanded(true, { source: config.source || 'chat' });
            setChatComposerVisible(true, config);
        },
        closeChatComposer() {
            setChatComposerVisible(false, { focus: false });
        },
        clearChatComposer() {
            const { chatInput } = ensureElements();
            if (chatInput) {
                chatInput.value = '';
            }
        },
        setChatComposerBusy(active) {
            const { chatInput, chatSendButton } = ensureElements();
            if (chatInput) {
                chatInput.disabled = Boolean(active);
            }
            if (chatSendButton) {
                chatSendButton.disabled = Boolean(active);
                setElementHtml(
                    chatSendButton,
                    active
                        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
                        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 20.5 4l-4.7 16-3.8-5-5-3.5Z" fill="currentColor"/></svg>'
                );
            }
        },
        setVoiceButtonActive(active) {
            const { micButton } = ensureElements();
            if (!micButton) return;
            micButton.dataset.active = active ? 'true' : 'false';
            setActivityIndicators({ voice: active });
        },
        setNotePanelState(nextState = {}) {
            const {
                noteButton,
                notePanel,
                notePanelMic,
                notePanelMicLabel,
                notePanelTitle,
                notePanelStatus,
                notePanelEditor,
                noteFillSummary,
                noteFillSummaryText,
                noteUndoButton,
                noteDiagnosisButton,
                noteDiagnosisStatus,
                noteDiagnosisNotice,
                noteDiagnosisList
            } = ensureElements();

            if (nextState.visible !== undefined) {
                state.note.open = Boolean(nextState.visible);
                if (state.note.open) {
                    setAssistantExpanded(true, { source: 'note-panel' });
                }
            }
            if (noteButton) {
                noteButton.dataset.active = state.note.open ? 'true' : 'false';
            }
            if (notePanel) {
                notePanel.dataset.visible = state.note.open ? 'true' : 'false';
                notePanel.setAttribute('aria-hidden', state.note.open && state.ui.expanded ? 'false' : 'true');
            }
            if (notePanelTitle && nextState.title !== undefined) {
                notePanelTitle.textContent = `${nextState.title || 'Nota clinica'}`.trim() || 'Nota clinica';
            }
            if (notePanelStatus && nextState.status !== undefined) {
                notePanelStatus.textContent = `${nextState.status || ''}`.trim();
            }
            if (notePanelEditor && nextState.content !== undefined) {
                const isUserEditing = document.activeElement === notePanelEditor;
                if (!isUserEditing) {
                    const content = `${nextState.content || ''}`;
                    setElementHtml(notePanelEditor, content.trim() ? renderMarkdown(content) : '');
                    notePanelEditor.scrollTop = notePanelEditor.scrollHeight;
                }
            }
            if (noteFillSummary && noteFillSummaryText && nextState.fillSummary !== undefined) {
                const summary = `${nextState.fillSummary || ''}`.trim();
                noteFillSummaryText.textContent = summary;
                noteFillSummary.dataset.visible = summary ? 'true' : 'false';
            }
            if (noteUndoButton && nextState.undoAvailable !== undefined) {
                const undoAvailable = Boolean(nextState.undoAvailable);
                noteUndoButton.disabled = !undoAvailable;
                noteUndoButton.setAttribute('aria-disabled', undoAvailable ? 'false' : 'true');
            }
            if (notePanelMic && (nextState.recording !== undefined || nextState.busy !== undefined)) {
                const recording = nextState.recording !== undefined
                    ? Boolean(nextState.recording)
                    : notePanelMic.dataset.active === 'true';
                const busy = nextState.busy !== undefined
                    ? Boolean(nextState.busy)
                    : Boolean(notePanelMic.disabled);
                notePanelMic.dataset.active = recording ? 'true' : 'false';
                notePanelMic.disabled = busy;
                notePanelMic.setAttribute('aria-label', recording ? 'Detener dictado' : 'Grabar nota');
                if (notePanelMicLabel) {
                    notePanelMicLabel.textContent = recording ? 'Detener' : (busy ? '...' : 'Grabar');
                }
                setActivityIndicators({ note: recording });
            }
            if (noteDiagnosisButton) {
                const diagnosisBusy = Boolean(nextState.diagnosisBusy);
                noteDiagnosisButton.disabled = Boolean(nextState.diagnosisDisabled) || diagnosisBusy;
                noteDiagnosisButton.textContent = diagnosisBusy ? 'Generando...' : 'Sugerir diagnosticos';
                noteDiagnosisButton.setAttribute('aria-busy', diagnosisBusy ? 'true' : 'false');
            }
            if (noteDiagnosisStatus) {
                const diagnosisError = `${nextState.diagnosisError || ''}`.trim();
                const diagnosisStatus = `${nextState.diagnosisStatus || ''}`.trim();
                noteDiagnosisStatus.textContent = diagnosisError || diagnosisStatus;
                noteDiagnosisStatus.dataset.error = diagnosisError ? 'true' : 'false';
            }
            if (noteDiagnosisNotice) {
                const notice = `${nextState.diagnosisReviewNotice || ''}`.trim();
                noteDiagnosisNotice.textContent = notice;
                noteDiagnosisNotice.hidden = !notice;
            }
            if (noteDiagnosisList && nextState.diagnosisSuggestions !== undefined) {
                noteDiagnosisList.replaceChildren();
                const suggestions = Array.isArray(nextState.diagnosisSuggestions)
                    ? nextState.diagnosisSuggestions
                    : [];
                suggestions.forEach((suggestion) => {
                    const card = document.createElement('article');
                    card.className = 'graph-assistant-note-diagnosis-card';

                    const title = document.createElement('strong');
                    title.textContent = `${suggestion?.title || ''}`;
                    const rationale = document.createElement('p');
                    rationale.textContent = `${suggestion?.rationale || ''}`;
                    const evidence = document.createElement('p');
                    evidence.className = 'graph-assistant-note-diagnosis-evidence';
                    evidence.textContent = `Evidencia en la nota: "${suggestion?.supportingEvidence || ''}"`;

                    card.append(title, rationale, evidence);
                    noteDiagnosisList.appendChild(card);
                });
            }
            positionBubbleNearShell();
        },
        stopAudibleSpeech() {
            stopAudibleSpeech();
        },
        moveToSelector(selector, options = {}) {
            if (!state.mounted) {
                api.mount();
            }

            if (state.pinned) {
                if (options.message) {
                    showBubble(options.message);
                }
                if (options.mode) {
                    setMode(options.mode);
                }
                return false;
            }

            const element = resolveElement(selector);
            if (!element) {
                if (options.message) {
                    showBubble(options.message);
                }
                return false;
            }

            positionNearRect(element.getBoundingClientRect());
            updateSpotlightForElement(options.spotlight === false ? null : element);
            if (options.message) {
                showBubble(options.message);
            }
            if (options.mode) {
                setMode(options.mode);
            }
            emit('move', { selector, found: true, options });
            return true;
        },
        clearSpotlight() {
            updateSpotlightForElement(null);
            if (!state.currentTour) {
                setMode('idle');
            }
        },
        pinBottomRight() {
            if (!state.mounted) {
                api.mount();
            }
            pinShellBottomRight();
            setMode('recording');
            updateSpotlightForElement(null);
        },
        unpin() {
            unpinShell();
        },
        startTour(tour = {}) {
            const stops = Array.isArray(tour.stops) ? tour.stops : [];
            state.currentTour = { ...tour, stops };
            state.currentStopIndex = -1;
            if (stops.length === 0) {
                api.speak('No encontre paradas para este recorrido.', { mode: 'tour' });
                return;
            }
            api.speak(tour.title || 'Te voy mostrando los puntos mas importantes.', { mode: 'tour' });
            api.nextTourStop();
        },
        nextTourStop() {
            if (!state.currentTour || !state.currentTour.stops.length) {
                return false;
            }

            state.currentStopIndex += 1;
            if (state.currentStopIndex >= state.currentTour.stops.length) {
                api.finishTour();
                return false;
            }

            const stop = state.currentTour.stops[state.currentStopIndex];
            const moved = api.moveToSelector(stop.selector, {
                spotlight: true,
                mode: 'tour',
                message: stop.message || stop.title || `Paso ${state.currentStopIndex + 1}`
            });

            if (!moved) {
                api.speak(`No pude ubicar ${stop.title || stop.selector}. Sigo con el siguiente punto.`, { mode: 'tour' });
                return api.nextTourStop();
            }

            emit('tour-stop', {
                index: state.currentStopIndex,
                stop,
                total: state.currentTour.stops.length
            });
            return true;
        },
        finishTour() {
            const lastTitle = state.currentTour?.title || 'Recorrido';
            state.currentTour = null;
            state.currentStopIndex = -1;
            api.speak(`${lastTitle} finalizado.`, { mode: 'idle' });
            window.setTimeout(() => api.clearSpotlight(), 1200);
            emit('tour-finished', {});
        },
        handleAutomationEvent(event = {}) {
            if (!event || !event.selector) {
                return;
            }

            const stepText = event.message
                || event.label
                || event.selector
                || 'Estoy trabajando en esta parte.';

            api.moveToSelector(event.selector, {
                spotlight: event.spotlight !== false,
                mode: event.mode || 'executing',
                message: stepText
            });
        },
        subscribe(eventName, handler) {
            if (!state.listeners.has(eventName)) {
                state.listeners.set(eventName, []);
            }
            state.listeners.get(eventName).push(handler);

            return () => {
                const current = state.listeners.get(eventName) || [];
                state.listeners.set(eventName, current.filter((candidate) => candidate !== handler));
            };
        }
    };

    window.addEventListener('resize', () => {
        if (!state.mounted) {
            return;
        }
        if (state.pinned) {
            pinShellBottomRight();
            return;
        }
        const shell = document.getElementById('graph-assistant-shell');
        if (!shell) {
            return;
        }
        const rect = shell.getBoundingClientRect();
        setShellPosition(rect.left + rect.width / 2, rect.top + rect.height / 2);
    });

    window.GraphAssistantRuntime = api;
    window.MiracleAssistantRuntime = api;
})();
