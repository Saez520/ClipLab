import { AuthorizationRequiredError, BlockedPipelineError, TransitionNotAllowedError, ValidationError } from './errors.js';
export const STATES = ['NOTE','SCRIPT','STORYBOARD','RENDER','FINAL'] as const;
export type PipelineState = typeof STATES[number];
export type VisibleState = PipelineState | 'BLOCKED';
export const ROLES = ['DIRECTOR','WRITER','STORYBOARD','EDITOR'] as const;
export type Role = typeof ROLES[number];
export const TRANSITIONS = [
  { from:'NOTE', to:'SCRIPT', role:'DIRECTOR' }, { from:'SCRIPT', to:'STORYBOARD', role:'WRITER' },
  { from:'STORYBOARD', to:'RENDER', role:'STORYBOARD' }, { from:'RENDER', to:'FINAL', role:'EDITOR' }
] as const;
export type Transition = typeof TRANSITIONS[number];
export function transitionFor(state: PipelineState): Transition {
  const t = TRANSITIONS.find(x => x.from === state); if (!t) throw new TransitionNotAllowedError('Pipeline is already FINAL'); return t;
}
export function validateAdvance(state: VisibleState, role: Role, authorized: boolean): Transition {
  if (state === 'BLOCKED') throw new BlockedPipelineError();
  const t = transitionFor(state);
  if (t.role !== role) throw new TransitionNotAllowedError(`Role ${role} cannot authorize ${t.from} to ${t.to}`);
  if (!authorized) throw new AuthorizationRequiredError();
  return t;
}
export function assertRole(value: string): Role { if (!ROLES.includes(value as Role)) throw new ValidationError('Invalid role'); return value as Role; }
