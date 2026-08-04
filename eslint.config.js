// Configuración plana de ESLint 9. Objetivo: atrapar errores reales (typos,
// variables no definidas, código muerto) sin imponer un estilo que obligue a
// reescribir 58k líneas. Ejecutar con `npm run lint`.
//
// Contrato: los `error` son el gate (CI falla). Los `warn` son deuda conocida
// y visible; al tocar un archivo, deja sus avisos en cero.
const js = require('@eslint/js');

// Reglas comunes a todo el repo.
const reglasBase = {
  // Los errores que de verdad rompen en producción.
  'no-undef': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-dupe-class-members': 'error',
  'no-unreachable': 'error',
  'no-self-assign': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-fallthrough': 'error',
  'no-cond-assign': ['error', 'always'],
  'no-empty': ['error', { allowEmptyCatch: true }],

  // Deuda conocida: no bloquea, pero se ve.
  'no-unused-vars': ['warn', {
    args: 'after-used',
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrors: 'none'
  }],
  eqeqeq: ['warn', 'smart'],
  'no-var': 'warn',
  'prefer-const': ['warn', { destructuring: 'all' }]
};

// Globals de Node (CommonJS).
const globalsNode = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  process: 'readonly',
  console: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  fetch: 'readonly',
  Response: 'readonly',
  Request: 'readonly',
  Headers: 'readonly',
  FormData: 'readonly',
  Blob: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  queueMicrotask: 'readonly',
  structuredClone: 'readonly',
  performance: 'readonly',
  crypto: 'readonly',
  globalThis: 'readonly',
  global: 'readonly'
};

// Globals de navegador. Se comparten entre web/public, la extensión y los
// scripts de verificación (que simulan DOM sobre globalThis).
const globalsNavegador = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'writable',
  history: 'readonly',
  screen: 'readonly',
  top: 'readonly',
  parent: 'readonly',
  frames: 'readonly',
  self: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  FormData: 'readonly',
  Headers: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  FileReader: 'readonly',
  WebSocket: 'readonly',
  EventSource: 'readonly',
  XMLHttpRequest: 'readonly',
  DOMParser: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  MutationObserver: 'readonly',
  IntersectionObserver: 'readonly',
  ResizeObserver: 'readonly',
  MediaRecorder: 'readonly',
  AudioContext: 'readonly',
  Audio: 'readonly',
  Image: 'readonly',
  CustomEvent: 'readonly',
  Event: 'readonly',
  KeyboardEvent: 'readonly',
  MouseEvent: 'readonly',
  InputEvent: 'readonly',
  Node: 'readonly',
  NodeFilter: 'readonly',
  Element: 'readonly',
  HTMLElement: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLTextAreaElement: 'readonly',
  HTMLSelectElement: 'readonly',
  HTMLOptionElement: 'readonly',
  HTMLButtonElement: 'readonly',
  HTMLAnchorElement: 'readonly',
  HTMLFormElement: 'readonly',
  HTMLCanvasElement: 'readonly',
  getComputedStyle: 'readonly',
  matchMedia: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  queueMicrotask: 'readonly',
  alert: 'readonly',
  confirm: 'readonly',
  prompt: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  crypto: 'readonly',
  structuredClone: 'readonly',
  performance: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  caches: 'readonly',
  clients: 'readonly',
  skipWaiting: 'readonly',
  importScripts: 'readonly',
  speechSynthesis: 'readonly',
  SpeechSynthesisUtterance: 'readonly'
};

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'generated/**',
      'public/**',
      'dist/**',
      'build/**',
      'coverage/**',
      '.vercel/**',
      '.agents/**'
    ]
  },

  // Backend, entrypoints serverless y tooling.
  {
    files: ['src/**/*.js', 'web/api/**/*.js', 'web/server.js', 'api/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: globalsNode
    },
    rules: { ...js.configs.recommended.rules, ...reglasBase }
  },

  // Scripts: Node, pero los verify-* simulan DOM para ejercitar el runtime
  // de navegador, así que necesitan ambos conjuntos de globals.
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globalsNavegador, ...globalsNode }
    },
    rules: { ...js.configs.recommended.rules, ...reglasBase }
  },

  // Runtime de navegador: se sirve tal cual desde web/public, sin bundler.
  // `chrome` está disponible porque plugin-host detecta si corre dentro de la
  // extensión y enruta fetch por el service worker.
  {
    files: ['web/public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globalsNavegador, chrome: 'readonly' }
    },
    rules: { ...js.configs.recommended.rules, ...reglasBase }
  },

  // web/public/miracle/** son módulos ES nativos (import/export), a diferencia
  // del resto de web/public que son scripts clásicos.
  {
    files: ['web/public/miracle/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globalsNavegador
    },
    rules: { ...js.configs.recommended.rules, ...reglasBase }
  },

  // Extensión de Chrome: navegador + API de extensiones.
  {
    files: ['chrome-extension-src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globalsNavegador, chrome: 'readonly' }
    },
    rules: { ...js.configs.recommended.rules, ...reglasBase }
  }
];
