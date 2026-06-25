export function getOpenCheckpoint(tab) {
  if (!tab) return null;
  const last = tab.checkpoints?.at(-1) || null;
  return last && last.isOpen ? last : null;
}

export function ensureOpenCheckpoint(tab) {
  let checkpoint = getOpenCheckpoint(tab);
  if (checkpoint) return checkpoint;
  checkpoint = {
    id: crypto.randomUUID(),
    label: "Checkpoint actual",
    kind: "working",
    createdAt: new Date().toISOString(),
    isOpen: true,
    entries: [],
  };
  tab.checkpoints = [...(tab.checkpoints || []), checkpoint];
  return checkpoint;
}

export function addEntryToCheckpoint(tab, entry) {
  if (!tab || !entry) return;
  const checkpoint = ensureOpenCheckpoint(tab);
  checkpoint.entries.push(entry);
  checkpoint.updatedAt = entry.timestamp;
  checkpoint.summary = entry.summary;
}

export function finalizeCheckpoint(tab, { label, kind }) {
  const checkpoint = getOpenCheckpoint(tab);
  if (!checkpoint || checkpoint.entries.length === 0) return;
  checkpoint.isOpen = false;
  checkpoint.label = label;
  checkpoint.kind = kind;
  checkpoint.closedAt = new Date().toISOString();
}
