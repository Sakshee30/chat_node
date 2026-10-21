import { AGENT_PURPOSE, type AgentPurpose } from './agent-purpose.js';

/** Domain defaults extracted from northstar_api/routers/agents.py.
 * These functions preserve legacy agent-creation semantics across the migration.
 * They do not create agents or bypass enrollment checks.
 */
export const AGENT_CHANNELS = [
  'website', 'whatsapp', 'telegram', 'instagram', 'facebook', 'slack',
  'teams', 'api', 'notion', 'zapier',
] as const;
export type AgentChannel = typeof AGENT_CHANNELS[number];

export const GENERIC_SUPPORT_INSTRUCTIONS =
  'Help visitors with accurate, concise answers. Use trusted knowledge first and clearly say when information is unavailable.';

export const PURPOSE_STARTER_INSTRUCTIONS: Readonly<Record<AgentPurpose, string>> = {
  support: 'Answer customer questions using trusted knowledge. Be clear, helpful, and escalate when information is missing.',
  lead_generation: 'Qualify each lead with one useful question at a time, understand their needs, and recommend the appropriate next step.',
  education: "Support enrolled students using only authorized course knowledge. Do not expose private course content until the platform has verified the student's active enrollment. Escalate identity or enrollment problems instead of guessing.",
};

export function agentAvatarInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() || 'N';
}

export interface AgentCreatePurpose {
  purpose?: AgentPurpose | null;
  template?: string | null;
}

export function createPurpose(payload: AgentCreatePurpose): AgentPurpose {
  if (payload.purpose !== undefined && payload.purpose !== null) {
    if (!Object.values(AGENT_PURPOSE).includes(payload.purpose)) {
      throw new TypeError('Unsupported agent purpose');
    }
    return payload.purpose;
  }
  return payload.template === 'lead' ? AGENT_PURPOSE.LEAD_GENERATION : AGENT_PURPOSE.SUPPORT;
}

export function starterInstructions(payload: AgentCreatePurpose, purpose: AgentPurpose): string {
  if (!(purpose in PURPOSE_STARTER_INSTRUCTIONS)) throw new TypeError('Unsupported agent purpose');
  return purpose === AGENT_PURPOSE.SUPPORT && payload.template !== 'support'
    ? GENERIC_SUPPORT_INSTRUCTIONS
    : PURPOSE_STARTER_INSTRUCTIONS[purpose];
}

export function parseAgentChannel(value: unknown): AgentChannel {
  if (typeof value !== 'string' || !AGENT_CHANNELS.some(channel => channel === value)) {
    throw new TypeError('Invalid agent deployment channel');
  }
  return value as AgentChannel;
}
