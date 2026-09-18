import { Telegraf } from 'telegraf';
import { ConversationState } from './conversation-state.js';
import { RegisterConversation } from './register-conversation.js';
import { StatusCommands } from './status-commands.js';
import { RegisterClientHandler } from '../commands/register-client.handler.js';
import { GetPendingClientsHandler } from '../queries/get-pending-clients.handler.js';
import { GetClientsByChatIdHandler } from '../queries/get-clients-by-chat-id.handler.js';

/**
 * Composition root: wires concrete adapters into the bot's command/callback
 * handlers. This is the only place that knows about Telegraf directly.
 *
 * @param {{ botToken: string, ownerChatId: number, clientRepository: import('../ports/client-repository.port.js').ClientRepository }} deps
 */
export function createTelegramBot({ botToken, ownerChatId, clientRepository }) {
  const bot = new Telegraf(botToken);

  const registerClientHandler = new RegisterClientHandler(clientRepository);
  const getPendingClientsHandler = new GetPendingClientsHandler(clientRepository);
  const getClientsByChatIdHandler = new GetClientsByChatIdHandler(clientRepository);

  const conversationState = new ConversationState();
  const registerConversation = new RegisterConversation(conversationState, registerClientHandler);
  const statusCommands = new StatusCommands(getClientsByChatIdHandler, getPendingClientsHandler, ownerChatId);

  bot.start((ctx) =>
    ctx.reply(
      "Welcome! This bot books Japan Embassy (Uzbekistan) visa appointment slots on your behalf.\n\n" +
        "Send /register to add yourself to the booking queue, or /mystatus to check where you stand."
    )
  );
  bot.command('register', (ctx) => registerConversation.handleRegisterCommand(ctx));
  bot.command('mystatus', (ctx) => statusCommands.handleMyStatus(ctx));
  bot.command('list', (ctx) => statusCommands.handleListPending(ctx));

  bot.action(/^register_category:(.+)$/, (ctx) => registerConversation.handleCategorySelected(ctx, ctx.match[1]));

  bot.on('text', async (ctx, next) => {
    const handled = await registerConversation.handleText(ctx);
    if (!handled) return next();
  });

  bot.catch((err, ctx) => {
    console.error(`Unhandled bot error for chat ${ctx.chat?.id}:`, err.message);
  });

  bot.telegram.setMyCommands([
    { command: 'register', description: 'Register for visa slot booking' },
    { command: 'mystatus', description: 'Check your registration status' },
    { command: 'list', description: 'List pending clients (owner only)' },
  ]);

  return bot;
}
