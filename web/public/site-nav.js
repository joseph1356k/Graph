// Shared mobile hamburger nav for Miracle marketing subpages.
(function () {
    function ready(fn) {
        if (document.readyState !== 'loading') { fn(); }
        else { document.addEventListener('DOMContentLoaded', fn); }
    }

    ready(function () {
        const header = document.querySelector('.site-header');
        const toggle = document.querySelector('.nav-toggle');
        const nav = document.querySelector('.header-nav');
        if (!header || !toggle || !nav) return;

        function setOpen(open) {
            header.classList.toggle('nav-open', open);
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
        }

        toggle.addEventListener('click', function (event) {
            event.stopPropagation();
            setOpen(!header.classList.contains('nav-open'));
        });
        nav.addEventListener('click', function (event) {
            if (event.target.closest('a')) setOpen(false);
        });
        document.addEventListener('click', function (event) {
            if (header.classList.contains('nav-open') && !header.contains(event.target)) setOpen(false);
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') setOpen(false);
        });
    });
})();
