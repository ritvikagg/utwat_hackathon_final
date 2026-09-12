import Anthropic from '@anthropic-ai/sdk';
import type { Page } from 'playwright';
import { extractPageState, executeAction } from './tools.js';
import type { ColdRunResult } from '../types.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MAX_STEPS = 15;

const tools: Anthropic.Tool[] = [
  {
    name: 'click',
    description: 'Click an interactive element by the [id] shown in the current page listing.',
    input_schema: {
      type: 'object',
      properties: { element_id: { type: 'number' } },
      required: ['element_id'],
    },
  },
  {
    name: 'type',
    description:
      'Type text into an input/textarea by the [id] shown in the current page listing. Overwrites existing content.',
    input_schema: {
      type: 'object',
      properties: {
        element_id: { type: 'number' },
        text: { type: 'string' },
      },
      required: ['element_id', 'text'],
    },
  },
  {
    name: 'goto',
    description: 'Navigate the browser to a URL.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
  {
    name: 'finish',
    description: 'Call this once the task is complete (or you are truly stuck) instead of another action.',
    input_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        summary: { type: 'string' },
      },
      required: ['success', 'summary'],
    },
  },
];

const MAX_STALE_TURNS = 2;

export async function runColdAgent(
  page: Page,
  task: string,
  tips?: string
): Promise<ColdRunResult> {
  let llmCalls = 0;
  let staleTurns = 0;
  const typedValues: string[] = [];

  const systemPrompt = [
    'You are a browser-automation agent. You are given a task and the current page state as a numbered list of interactive elements.',
    'Call exactly one tool per turn. Re-read the page listing after every action since it changes.',
    'The task is complete the moment the described action succeeds — call finish(success: true) immediately. Do not pursue anything on a resulting page unless the task explicitly asks for it. Call finish(success: false) only if you are truly stuck after a few attempts.',
    tips ? `Known tips from prior runs on this site:\n${tips}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages: Anthropic.MessageParam[] = [];
  let elements = (await extractPageState(page)).elements;

  const describeState = async (): Promise<string> => {
    const state = await extractPageState(page);
    elements = state.elements;
    return `Task: ${task}\nCurrent URL: ${page.url()}\nInteractive elements:\n${state.text || '(none found)'}`;
  };

  messages.push({ role: 'user', content: await describeState() });

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      messages,
    });
    llmCalls += 1;
    messages.push({ role: 'assistant', content: response.content });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    if (!toolUse) {
      staleTurns += 1;
      if (staleTurns > MAX_STALE_TURNS) {
        return { success: false, summary: 'Model stopped calling tools.', llmCalls, typedValues };
      }
      messages.push({
        role: 'user',
        content: 'You must call one of the provided tools (click, type, goto, or finish). Continue the task.',
      });
      continue;
    }
    staleTurns = 0;

    if (toolUse.name === 'finish') {
      const input = toolUse.input as { success: boolean; summary: string };
      return { success: input.success, summary: input.summary, llmCalls, typedValues };
    }

    const result = await executeAction(
      page,
      elements,
      toolUse.name,
      toolUse.input as Record<string, unknown>,
      typedValues
    );
    const newState = await describeState();
    messages.push({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: toolUse.id, content: result },
        { type: 'text', text: newState },
      ],
    });
  }

  return { success: false, summary: 'Hit max step limit.', llmCalls, typedValues };
}
