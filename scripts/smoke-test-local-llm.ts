import 'dotenv/config';
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: process.env.LOCAL_LLM_BASE_URL || 'http://localhost:1234/v1',
  apiKey: process.env.LOCAL_LLM_API_KEY || 'lm-studio',
});
const MODEL = process.env.LOCAL_LLM_MODEL || 'local-model';

async function main() {
  console.log(`Talking to ${process.env.LOCAL_LLM_BASE_URL || 'http://localhost:1234/v1'} (model: ${MODEL})`);

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: 'You must respond by calling the given tool — never plain text.' },
      { role: 'user', content: 'Click the element with id 3.' },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'click',
          description: 'Click an element by id.',
          parameters: {
            type: 'object',
            properties: { element_id: { type: 'number' } },
            required: ['element_id'],
          },
        },
      },
    ],
    tool_choice: 'required',
  });

  const call = response.choices[0].message.tool_calls?.[0];
  if (!call || call.type !== 'function') {
    console.error('No tool call returned. Message content was:', response.choices[0].message.content);
    console.error('This model/LM Studio build may not support reliable function calling for the agent loop.');
    process.exit(1);
  }

  console.log('Tool call received:', call.function.name, call.function.arguments);
  console.log('Local LLM tool-calling smoke test passed.');
}

main().catch((err) => {
  console.error(err);
  console.error('\nIs the LM Studio local server running? (Developer / Local Server tab -> Start Server)');
  process.exit(1);
});
