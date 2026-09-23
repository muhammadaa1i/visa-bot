import fs from 'fs';

/**
 * The slot monitor (recon/monitor.js, a separate process) writes an alert file while slots are
 * open and deletes it when they're gone. This fires once each time that file appears, including
 * at startup if it's already there. Booking stays in the bot process because the bot is the only
 * writer of the client file.
 */
export class SlotSignalFileWatcher {
  /** @param {string} filePath @param {{ pollIntervalMs: number }} options */
  constructor(filePath, { pollIntervalMs }) {
    this.filePath = filePath;
    this.pollIntervalMs = pollIntervalMs;
  }

  /** @param {() => void} onSlotsOpened */
  start(onSlotsOpened) {
    if (fs.existsSync(this.filePath)) onSlotsOpened();
    // watchFile reports a missing file as mtimeMs 0, so 0 → non-zero means the file just appeared.
    fs.watchFile(this.filePath, { interval: this.pollIntervalMs }, (current, previous) => {
      if (previous.mtimeMs === 0 && current.mtimeMs !== 0) onSlotsOpened();
    });
  }

  stop() {
    fs.unwatchFile(this.filePath);
  }
}
