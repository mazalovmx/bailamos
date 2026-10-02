import type {ChatMessage} from './contract';
// DeepSeek speaks the OpenAI chat-completions dialect; JSON mode makes the answer a single JSON object.
// Only the announcement text and the reference context are sent — never anything about the user.
export type Llm = (messages: ChatMessage[], signal: AbortSignal) => Promise<string>;
export const parserModel = () => process.env.DEEPSEEK_MODEL || 'deepseek-chat';
export const parserEnabled = () => !!process.env.DEEPSEEK_API_KEY;
export const deepseek: Llm = async (messages, signal) => {
  const base = (process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  const response = await fetch(base + '/chat/completions', {method: 'POST', signal,
    headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.DEEPSEEK_API_KEY},
    body: JSON.stringify({model: parserModel(), messages, response_format: {type: 'json_object'}, temperature: 0, max_tokens: 700, stream: false})});
  if (!response.ok) throw new Error('LLM_HTTP_' + response.status);
  const data = await response.json() as {choices?: {message?: {content?: unknown}}[]};
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('LLM_EMPTY');
  return content;
};
