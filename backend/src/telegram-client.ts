import { setTimeout as delay } from 'node:timers/promises';

export const TELEGRAM_TEXT_LIMIT = 4096;
export const COURSE_SWITCH_HINT = 'Send switch course anytime to see this menu again.';

export class TelegramAPIError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number | null = null,
    public readonly retryable = false,
    public readonly requiresReconnect = false,
    public readonly retryAfterSeconds: number | null = null,
  ) { super(message); this.name = 'TelegramAPIError'; }
}

export function splitTelegramText(text: string, limit = TELEGRAM_TEXT_LIMIT): string[] {
  const value = text.trim();
  if (!value) return [];
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Telegram text chunk limit must be positive');
  const chunks: string[] = [];
  let remaining = Array.from(value);
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit);
    const lastBreak = Math.max(window.lastIndexOf('\n'), window.lastIndexOf(' '));
    const splitAt = lastBreak < Math.max(1, Math.floor(limit / 2)) ? limit : lastBreak;
    let chunk = remaining.slice(0, splitAt).join('').trimEnd();
    let used = splitAt;
    if (!chunk) { chunk = remaining.slice(0, limit).join(''); used = limit; }
    chunks.push(chunk);
    remaining = Array.from(remaining.slice(used).join('').trimStart());
  }
  if (remaining.length) chunks.push(remaining.join(''));
  return chunks;
}
const isRecord = (x: unknown): x is Record<string,unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
const integer = (x: unknown): number | null =>
  x === null || x === undefined || typeof x === 'boolean' || !Number.isSafeInteger(Number(x))
    ? null : Number(x);

export class TelegramBotClient {
  private readonly http: typeof fetch;
  private readonly timeoutSeconds: number;
  constructor(options: { http?: typeof fetch; timeoutSeconds?: number } = {}) {
    this.http = options.http ?? fetch;
    this.timeoutSeconds = options.timeoutSeconds ?? 10;
  }

  async request(botToken: string, method: string, payload: Record<string,unknown> = {}): Promise<unknown> {
    const token = botToken.trim();
    if (!token) throw new TelegramAPIError('Telegram bot token is not configured', null, false, true);
    let response: Response;
    try {
      response = await this.http(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST', headers: {'content-type':'application/json'},
        body: JSON.stringify(payload), signal: AbortSignal.timeout(this.timeoutSeconds * 1000),
      });
    } catch (error) {
      const timeout = error instanceof Error && ['AbortError','TimeoutError'].includes(error.name);
      throw new TelegramAPIError(timeout ? 'Telegram request timed out' : 'Telegram network request failed', null, true);
    }
    let data: Record<string,unknown> = {};
    try { const parsed: unknown = await response.json(); if (isRecord(parsed)) data = parsed; }
    catch { /* invalid response is a provider error */ }
    if (response.ok && data.ok === true) return data.result;
    const status = integer(data.error_code) ?? response.status;
    const params = isRecord(data.parameters) ? data.parameters : {};
    throw new TelegramAPIError(String(data.description || 'Telegram Bot API request failed').slice(0,500),
      status, status === 429 || status >= 500, status === 401 || status === 403, integer(params.retry_after));
  }

  async getMe(token: string): Promise<Record<string,unknown>> {
    const value = await this.request(token,'getMe');
    if (!isRecord(value)) throw new TelegramAPIError('Telegram returned an invalid bot identity');
    return value;
  }
  async getManagedBotToken(token: string, botId: string): Promise<string> {
    const id = integer(botId);
    if (id === null) throw new TelegramAPIError('Invalid managed Telegram bot ID');
    const result = await this.request(token,'getManagedBotToken',{user_id:id});
    if (typeof result !== 'string' || !result) throw new TelegramAPIError('Telegram did not return a managed bot token');
    return result;
  }
  async setWebhook(token: string, options: {url:string; secretToken:string; allowedUpdates?:string[]}): Promise<void> {
    const result = await this.request(token,'setWebhook',{
      url:options.url,secret_token:options.secretToken,
      allowed_updates: options.allowedUpdates?.length ? options.allowedUpdates :
        ['message','edited_message','business_message'],
    });
    if (result !== true) throw new TelegramAPIError('Telegram webhook registration was not acknowledged');
  }
  async deleteWebhook(token: string): Promise<void> {
    if (await this.request(token,'deleteWebhook',{drop_pending_updates:true}) !== true)
      throw new TelegramAPIError('Telegram did not acknowledge webhook removal');
  }
  async getWebhookInfo(token:string):Promise<Record<string,unknown>> {
    const result=await this.request(token,'getWebhookInfo');
    if (!isRecord(result)) throw new TelegramAPIError('Telegram returned invalid webhook information');
    return result;
  }
  async allowManagedBotStudents(token:string,botId:string):Promise<void> {
    const id=integer(botId);
    if (id===null) throw new TelegramAPIError('Invalid managed Telegram bot ID');
    if (await this.request(token,'setManagedBotAccessSettings',{user_id:id,is_access_restricted:false})!==true)
      throw new TelegramAPIError('Telegram could not enable student access');
  }
  async answerCallback(token:string,callbackId:string):Promise<void> {
    await this.request(token,'answerCallbackQuery',{callback_query_id:callbackId});
  }
  async sendText(token:string,options:{chatId:string;text:string;replyMarkup?:Record<string,unknown>}):Promise<string> {
    const hasHint=options.text.includes(COURSE_SWITCH_HINT);
    const text=hasHint ? options.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#x27;')
      .replaceAll(COURSE_SWITCH_HINT,'Send <b>switch course</b> anytime to see this menu again.')
      : options.text;
    const result=await this.request(token,'sendMessage',{
      chat_id:options.chatId,text,...(hasHint?{parse_mode:'HTML'}:{}),
      ...(options.replyMarkup?{reply_markup:options.replyMarkup}:{}),
    });
    if (!isRecord(result) || result.message_id === undefined || result.message_id === null)
      throw new TelegramAPIError('Telegram accepted the request without returning a message ID');
    return String(result.message_id);
  }
}
