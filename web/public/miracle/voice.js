import { createVoiceStreamingController } from "/miracle/assets/voice/controller.js";

const controller = createVoiceStreamingController({
  recordToggleButton: document.getElementById("recordToggleButton"),
  transcriptOutput: document.getElementById("transcriptOutput"),
});

controller.bindEvents();
window.addEventListener("beforeunload", () => controller.dispose());
