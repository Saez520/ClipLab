export class DomainError extends Error { constructor(public readonly code: string, message: string, public readonly details?: unknown) { super(message); this.name = 'DomainError'; } }
export class ValidationError extends DomainError { constructor(message: string, details?: unknown) { super('VALIDATION_ERROR', message, details); } }
export class TransitionNotAllowedError extends DomainError { constructor(message = 'Transition is not allowed') { super('TRANSITION_NOT_ALLOWED', message); } }
export class AuthorizationRequiredError extends DomainError { constructor(message = 'Explicit authorization is required') { super('AUTHORIZATION_REQUIRED', message); } }
export class BlockedPipelineError extends DomainError { constructor(message = 'Pipeline is blocked') { super('PIPELINE_BLOCKED', message); } }
export class NotFoundError extends DomainError { constructor(message = 'Opportunity not found') { super('NOT_FOUND', message); } }
