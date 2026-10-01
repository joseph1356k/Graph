#!/usr/bin/env node
// Regenera tests/fixtures/agent-platform/windows-snapshot.json: lo que el turno de
// Windows le MANDA al proveedor (catálogo, prompt, requests de dos turnos) y lo que
// le devuelve al cliente, sacado con las mismas entradas que vuelve a usar
// verify-agent-platform.js (scripts/lib/agentTurnCapture.js).
//
//   node scripts/lib/write-windows-snapshot.js "<de dónde sale y por qué>"
//
// SE CORRE A MANO Y A PROPÓSITO, cuando el cambio del prompt o del catálogo de
// Windows es el que se quería. Nunca para poner verde un rojo que no se entiende.
// Lo que U.exe VE de un turno no está aquí sino en windows-contract-e9d0d44.json,
// que no se regenera: si ese se pone rojo, cambió el contrato con el cliente.
const fs = require('fs');
const path = require('path');
const { captureConversation, captureErrors, windowsPrompts, PROVIDER_ENVS } = require('./agentTurnCapture');
const { baseCatalog } = require('../../src/domain/agent/mcpCatalog');

const TARGET = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'agent-platform', 'windows-snapshot.json');

async function main() {
  const takenFrom = `${process.argv[2] || ''}`.trim();
  if (!takenFrom) {
    console.error('Falta el motivo: node scripts/lib/write-windows-snapshot.js "<commit> — <por qué se regenera>"');
    process.exit(2);
  }
  const snapshot = {
    takenFrom,
    catalog: baseCatalog(),
    prompts: windowsPrompts(),
    conversations: {
      openai: await captureConversation({ env: PROVIDER_ENVS.openai }),
      gemini: await captureConversation({ env: PROVIDER_ENVS.gemini })
    },
    errors: await captureErrors()
  };
  fs.writeFileSync(TARGET, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`windows-snapshot.json regenerado (${fs.statSync(TARGET).size} bytes): ${takenFrom}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
