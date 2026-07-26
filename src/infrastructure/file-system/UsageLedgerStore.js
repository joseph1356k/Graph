// @ts-check
const fs = require('fs');
const path = require('path');

class UsageLedgerStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  ensureReady() {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, '', 'utf8');
    }
  }

  append(event) {
    this.ensureReady();
    fs.appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, 'utf8');
    return event;
  }

  readAll() {
    this.ensureReady();
    const raw = fs.readFileSync(this.filePath, 'utf8');
    if (!raw.trim()) {
      return [];
    }

    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          return null;
        }
      })
      .filter(Boolean);
  }
}

module.exports = UsageLedgerStore;
