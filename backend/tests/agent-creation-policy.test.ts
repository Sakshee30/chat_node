import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_CHANNELS, GENERIC_SUPPORT_INSTRUCTIONS, PURPOSE_STARTER_INSTRUCTIONS,
  agentAvatarInitial, createPurpose, starterInstructions, parseAgentChannel,
} from '../src/agent-creation-policy.js';

test('legacy lead template maps to lead generation; omitted template defaults to support', () => {
  assert.equal(createPurpose({ template: 'lead' }), 'lead_generation');
  assert.equal(createPurpose({}), 'support');
  assert.equal(createPurpose({ template: 'support' }), 'support');
});
test('explicit purpose always overrides legacy template, including education', () => {
  assert.equal(createPurpose({ template: 'lead', purpose: 'education' }), 'education');
  assert.equal(createPurpose({ template: 'lead', purpose: 'support' }), 'support');
  assert.throws(() => createPurpose({purpose:'superuser' as never}), /Unsupported/);
});
test('legacy generic support and explicit support starter are distinct', () => {
  assert.equal(starterInstructions({}, 'support'), GENERIC_SUPPORT_INSTRUCTIONS);
  assert.equal(starterInstructions({template:'support'}, 'support'), PURPOSE_STARTER_INSTRUCTIONS.support);
  assert.equal(starterInstructions({template:'lead'}, 'lead_generation'), PURPOSE_STARTER_INSTRUCTIONS.lead_generation);
});
test('education starter never assumes enrollment has been verified', () => {
  const instructions = starterInstructions({purpose:'education'}, 'education');
  assert.match(instructions, /verified the student's active enrollment/);
  assert.match(instructions, /Do not expose private course content/);
});
test('agent avatar defaults and allowed channel names match source', () => {
  assert.equal(agentAvatarInitial('  Tutor  '), 'T');
  assert.equal(agentAvatarInitial(' '), 'N');
  assert.equal(AGENT_CHANNELS.length, 10);
  assert.equal(parseAgentChannel('telegram'), 'telegram');
  assert.equal(parseAgentChannel('website'), 'website');
  assert.throws(() => parseAgentChannel('fake'), /Invalid/);
  assert.throws(() => parseAgentChannel(null), /Invalid/);
});
