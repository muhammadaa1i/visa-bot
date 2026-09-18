import fs from 'fs/promises';
import path from 'path';
import { ClientRepository } from '../ports/client-repository.port.js';

/**
 * File-backed ClientRepository. Writes are serialized through a single
 * in-process queue so concurrent save()/update() calls can't race and
 * corrupt the file (this process is the only writer).
 */
export class JsonClientRepository extends ClientRepository {
  /** @param {string} filePath */
  constructor(filePath) {
    super();
    this.filePath = filePath;
    this.writeQueue = Promise.resolve();
  }

  async #readAll() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async #writeAll(clients) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(clients, null, 2), 'utf8');
    await fs.rename(tmpPath, this.filePath);
  }

  #enqueue(task) {
    this.writeQueue = this.writeQueue.then(task, task);
    return this.writeQueue;
  }

  /** @param {import('../domain/client.js').Client} client */
  async save(client) {
    await this.#enqueue(async () => {
      const clients = await this.#readAll();
      clients.push(client);
      await this.#writeAll(clients);
    });
  }

  /** @param {string} id */
  async findById(id) {
    const clients = await this.#readAll();
    return clients.find((c) => c.id === id) ?? null;
  }

  /** @param {number} telegramChatId */
  async findByChatId(telegramChatId) {
    const clients = await this.#readAll();
    return clients.filter((c) => c.telegramChatId === telegramChatId);
  }

  async findPending() {
    const clients = await this.#readAll();
    return clients.filter((c) => c.status === 'pending');
  }

  /** @param {import('../domain/client.js').Client} client */
  async update(client) {
    await this.#enqueue(async () => {
      const clients = await this.#readAll();
      const index = clients.findIndex((c) => c.id === client.id);
      if (index === -1) throw new Error(`Client ${client.id} not found`);
      clients[index] = client;
      await this.#writeAll(clients);
    });
  }
}
