import OpenAI from 'openai';
import type { Page } from 'playwright';
import { extractPageState, executeAction } from './tools.js';
import type { ColdRunResult, TraceStep } from '../types.js';

const client = new OpenAI({
  baseURL: process.env.LOCAL_LLM_BASE_URL || 'http://localhost:1234/v1',
  // LM Studio ignores the key but the SDK requires a non-empty string.
  apiKey: process.env.LOCAL_LLM_API_KEY || 'lm-studio',
});
const MODEL = process.env.LOCAL_LLM_MODEL || 'local-model';
const MAX_STEPS = 25;

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'click',
      description: 'Click an interactive element by the [id] shown in the current page listing.',
      parameters: {
        type: 'object',
        properties: { element_id: { type: 'number' } },
        required: ['element_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'type',
      description:
        'Type text into an input/textarea by the [id] shown in the current page listing. Overwrites existing content.',
      parameters: {
        type: 'object',
        properties: {
          element_id: { type: 'number' },
          text: { type: 'string' },
        },
        required: ['element_id', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'goto',
      description: 'Navigate the browser to a URL.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: 'Call this once the task is complete (or you are truly stuck) instead of another action.',
      parameters: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          summary: { type: 'string' },
        },
        required: ['success', 'summary'],
      },
    },
  },
];

const MAX_STALE_TURNS = 2;

/** Same contract as runColdAgent in loop.ts, backed by an LM Studio (or any
 *  OpenAI-compatible) local server instead of the Anthropic API. */
export async function runColdAgentLocal(
  page: Page,
  task: string,
  tips?: string
): Promise<ColdRunResult> {
  let llmCalls = 0;
  let staleTurns = 0;
  const trace: TraceStep[] = [];

  const systemPrompt = [
    'You are a browser-automation agent. You are given a task and the current page state as a numbered list of interactive elements.',
    'You must respond by calling exactly one of the provided tools — never reply with plain text.',
    'Re-read the page listing after every action since it changes.',
    'The task is complete the moment the described action succeeds — call finish(success: true) immediately. Do not pursue anything on a resulting page unless the task explicitly asks for it. Call finish(success: false) only if you are truly stuck after a few attempts.',
    tips ? `Known tips from prior runs on this site:\n${tips}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  let elements = (await extractPageState(page)).elements;

  const describeState = async (): Promise<string> => {
    const state = await extractPageState(page);
    elements = state.elements;
    return `Task: ${task}\nCurrent URL: ${page.url()}\nInteractive elements:\n${state.text || '(none found)'}`;
  };

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: await describeState() },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      tool_choice: 'required',
    });
    llmCalls += 1;

    const message = response.choices[0].message;
    messages.push(message);

    const calls = (message.tool_calls ?? []).filter((c) => c.type === 'function');
    if (calls.length === 0) {
      staleTurns += 1;
      if (staleTurns > MAX_STALE_TURNS) {
        return { success: false, summary: 'Model stopped calling tools.', llmCalls, trace };
      }
      messages.push({
        role: 'user',
        content: 'You must call one of the provided tools (click, type, goto, or finish). Continue the task.',
      });
      continue;
    }
    staleTurns = 0;

    // Some models issue more than one tool call per turn. The API requires a
    // 'tool' message for EVERY tool_call_id or the next request is rejected
    // — so every call in this batch gets answered, not just the first.
    for (const call of calls) {
      if (call.function.name === 'finish') {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          // Treat as failure below via Boolean(undefined) => false.
        }
        const { success, summary } = args as { success?: boolean; summary?: string };
        return { success: Boolean(success), summary: summary ?? '', llmCalls, trace };
      }
    }

    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        // Leave args empty — executeAction reports the missing/invalid element.
      }
      const result = await executeAction(page, elements, call.function.name, args, trace);
      console.log(`  -> ${call.function.name}(${JSON.stringify(args)}) => ${result}`);
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
    const newState = await describeState();
    messages.push({ role: 'user', content: newState });
  }

  return { success: false, summary: 'Hit max step limit.', llmCalls, trace };
}
