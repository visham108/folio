// Shared helpers for Folio's AI edge functions (Deno, Supabase).
// ANTHROPIC_API_KEY is set with: supabase secrets set ANTHROPIC_API_KEY=...
import Anthropic from 'npm:@anthropic-ai/sdk'

export const MODEL = 'claude-opus-5-5'

export const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/**
 * One structured-output call. Uses server-side fallbacks so a classifier
 * decline is retried on Anthropic's recommended fallback model instead of failing.
 * Returns null on refusal or unparseable output; the app then falls back to
 * on-device behaviour.
 */
export async function structured<T>(opts: {
  system: string
  /** Message content blocks (text / image), in Messages API shape. */
  content: Record<string, unknown>[]
  schema: Record<string, unknown>
  effort: 'low' | 'medium' | 'high'
}): Promise<T | null> {
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    // @ts-ignore: newer request fields; the SDK passes them through.
    fallbacks: 'default',
    output_config: { effort: opts.effort, format: { type: 'json_schema', schema: opts.schema } },
    system: opts.system,
    // deno-lint-ignore no-explicit-any
    messages: [{ role: 'user', content: opts.content as any }],
  })
  if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') return null
  const text = res.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') return null
  try {
    return JSON.parse(text.text) as T
  } catch {
    return null
  }
}
