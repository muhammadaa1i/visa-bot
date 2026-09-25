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
    let present = fs.existsSync(this.filePath);
    if (present) onSlotsOpened();
    // watchFile reports a missing file as mtimeMs 0. Its `previous` can't be trusted for this: when a
    // file disappears and reappears, `previous` on the reappearance still holds the stats from before
    // it disappeared, which made every opening after the first go unnoticed. So track presence here.
    fs.watchFile(this.filePath, { interval: this.pollIntervalMs }, (current) => {
      const nowPresent = current.mtimeMs !== 0;
      if (nowPresent && !present) onSlotsOpened();
      present = nowPresent;
    });
  }

  stop() {
    fs.unwatchFile(this.filePath);
  }
}
