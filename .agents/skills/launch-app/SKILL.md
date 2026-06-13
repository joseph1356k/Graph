---
name: launch-app
description: Launch Graph in Miracle-backed mode for runtime validation of the web demo, recorder flow, and medical-note integration.
---

# Launch App

Use this skill when a ticket touches the web app, recorder flow, workflow playback UX, medical notes, or the Miracle integration boundary.

## Goal

Launch Graph against the Miracle-backed runtime path when possible, then validate the exact user or API flow changed by the ticket.

## Runtime assumptions

- Graph runs from this repo.
- The web server defaults to `http://127.0.0.1:3000`.
- Miracle-backed mode expects `MIRACLE_MEDICAL_ENGINE_URL=http://127.0.0.1:8766`.
- Miracle is treated as an external dependency. Do not modify external repos or services just to make validation pass.

## Recommended launch flow

1. Check whether the Miracle sidecar appears reachable.
   - Try a lightweight probe such as `curl -sS http://127.0.0.1:8766/api/setup/status`.
   - If that endpoint is unavailable, note the failure and continue checking whether the Graph app itself can still be launched for partial validation.
2. Start Graph in Miracle-backed mode on a non-default port to avoid collisions:
   - PowerShell: `$env:WEB_PORT='3001'; $env:MIRACLE_MEDICAL_ENGINE_URL='http://127.0.0.1:8766'; npm.cmd start`
3. Confirm the app is serving:
   - `curl.exe -sS http://127.0.0.1:3001/api/public-config`
   - `curl.exe -sS http://127.0.0.1:3001/api/health`
4. For UI-touching work, also load:
   - `http://127.0.0.1:3001/`
   - Use browser-based inspection or targeted HTTP checks to verify the changed path.

## Validation expectations

- For recorder or workflow-catalog work:
  - Verify Graph launches.
  - Exercise the affected workflow APIs or UI path.
  - Confirm any resulting catalog or replay behavior matches the ticket intent.
- For Miracle integration work:
  - Prefer validating the exact request or UI flow that crosses from Graph into the Miracle-backed path.
  - Record whether the sidecar was reachable and what endpoint or interaction proved the integration.
- For medical-notes work:
  - Verify note session endpoints still respond.
  - Verify the active-note flow affected by the change behaves as expected.

## If Miracle is unavailable

- Treat this as a runtime validation gap, not an excuse to skip all validation.
- Still run tests, launch Graph if possible, and validate every part of the flow that does not require the external engine.
- In the workpad, state exactly which Miracle-dependent proof could not be executed and why.
