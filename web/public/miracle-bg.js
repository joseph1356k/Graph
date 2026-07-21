/*
 * Miracle animated background — a persistent particle constellation that lives
 * behind the page content. Same aesthetic as the login gate (auth-gate.js), but
 * standalone so any surface can share the look by loading this script.
 *
 * It paints a fixed, full-viewport <canvas> at z-index 0. The canvas clears to
 * transparent each frame, so the page's own body background (base black + aurora
 * glow) shows through and the moving nodes/links float on top of it.
 */
(function () {
    if (window.__miracleBgStarted) return;
    window.__miracleBgStarted = true;

    const prefersReduced = window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function start() {
        if (document.getElementById('miracle-bg-canvas')) return;

        const canvas = document.createElement('canvas');
        canvas.id = 'miracle-bg-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = [
            'position:fixed',
            'inset:0',
            'z-index:0',
            'width:100%',
            'height:100%',
            'pointer-events:none',
            'opacity:0.85'
        ].join(';');
        (document.body || document.documentElement).appendChild(canvas);

        const ctx = canvas.getContext('2d');
        let width = 0;
        let height = 0;
        let dpr = Math.min(window.devicePixelRatio || 1, 2);
        let particles = [];
        const pointer = { x: -9999, y: -9999 };

        function resize() {
            width = window.innerWidth;
            height = window.innerHeight;
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const count = Math.max(40, Math.min(120, Math.floor((width * height) / 15000)));
            particles = Array.from({ length: count }, () => ({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * 0.26,
                vy: (Math.random() - 0.5) * 0.26,
                r: Math.random() * 1.4 + 0.5
            }));
        }

        function onPointerMove(event) {
            const point = event.touches ? event.touches[0] : event;
            if (!point) return;
            pointer.x = point.clientX;
            pointer.y = point.clientY;
        }

        function onPointerLeave() {
            pointer.x = -9999;
            pointer.y = -9999;
        }

        function drawFrame(animate) {
            ctx.clearRect(0, 0, width, height);

            if (animate) {
                for (const p of particles) {
                    p.x += p.vx;
                    p.y += p.vy;
                    if (p.x <= 0 || p.x >= width) p.vx *= -1;
                    if (p.y <= 0 || p.y >= height) p.vy *= -1;
                    const dxp = p.x - pointer.x;
                    const dyp = p.y - pointer.y;
                    const distPointer = Math.sqrt(dxp * dxp + dyp * dyp);
                    if (distPointer < 150) {
                        const push = (150 - distPointer) / 150;
                        p.x += (dxp / (distPointer || 1)) * push * 0.7;
                        p.y += (dyp / (distPointer || 1)) * push * 0.7;
                    }
                }
            }

            for (let i = 0; i < particles.length; i++) {
                const a = particles[i];
                for (let j = i + 1; j < particles.length; j++) {
                    const b = particles[j];
                    const dx = a.x - b.x;
                    const dy = a.y - b.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 128) {
                        ctx.strokeStyle = `rgba(255,255,255,${0.14 * (1 - dist / 128)})`;
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(a.x, a.y);
                        ctx.lineTo(b.x, b.y);
                        ctx.stroke();
                    }
                }
                const dxm = a.x - pointer.x;
                const dym = a.y - pointer.y;
                const distMouse = Math.sqrt(dxm * dxm + dym * dym);
                if (distMouse < 190) {
                    ctx.strokeStyle = `rgba(255,255,255,${0.26 * (1 - distMouse / 190)})`;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(pointer.x, pointer.y);
                    ctx.stroke();
                }
            }

            for (const p of particles) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255,255,255,0.5)';
                ctx.shadowColor = 'rgba(255,255,255,0.45)';
                ctx.shadowBlur = 6;
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        }

        resize();
        window.addEventListener('resize', resize);
        // The tab can be laid out (or first painted) after this script runs — e.g.
        // it loaded while hidden and had zero dimensions. Re-measure on load too.
        window.addEventListener('load', resize);

        if (prefersReduced) {
            // One static frame — no motion, no pointer interaction.
            if (!width || !height) resize();
            drawFrame(false);
            window.addEventListener('load', () => drawFrame(false));
            return;
        }

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerleave', onPointerLeave);

        let rafId = null;
        const loop = () => {
            // Guard against a stale zero-size buffer (tab first painted after init).
            if (!width || !height) resize();
            drawFrame(true);
            rafId = window.requestAnimationFrame(loop);
        };

        function handleVisibility() {
            if (document.hidden) {
                if (rafId) {
                    window.cancelAnimationFrame(rafId);
                    rafId = null;
                }
            } else {
                resize();
                if (!rafId) rafId = window.requestAnimationFrame(loop);
            }
        }
        document.addEventListener('visibilitychange', handleVisibility);

        rafId = window.requestAnimationFrame(loop);
    }

    if (document.body) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start);
    }
})();
