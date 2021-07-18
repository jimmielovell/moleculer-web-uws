'use strict';

const { MoleculerError, MoleculerClientError } = require('moleculer').Errors;

// Invalid request body
class InvalidRequestBodyError extends MoleculerError {
	constructor(body, error) {
		super('Invalid request body', 400, 'INVALID_REQUEST_BODY', {
			body,
			error
		});
	}
}

// Invalid response type
class InvalidResponseTypeError extends MoleculerError {
	constructor(dataType) {
		super(`Invalid response type '${dataType}'`, 500, 'INVALID_RESPONSE_TYPE', {
			dataType
		});
	}
}

// Unauthorized HTTP error
class UnAuthorizedError extends MoleculerError {
	constructor(type, data) {
		super('Unauthorized', 401, type || ERR_INVALID_TOKEN, data);
	}
}

// Forbidden HTTP error
class ForbiddenError extends MoleculerError {
	constructor(type, data) {
		super('Forbidden', 403, type, data);
	}
}

// Bad request HTTP error
class BadRequestError extends MoleculerError {
	constructor(type, data) {
		super('Bad request', 400, type, data);
	}
}

// Not found HTTP error
class NotFoundError extends MoleculerError {
	constructor(type, data) {
		super('Not found', 404, type || 'NOT_FOUND', data);
	}
}

// Payload is too large HTTP error
class PayloadTooLarge extends MoleculerClientError {
	constructor(data) {
		super('Payload too large', 413, 'PAYLOAD_TOO_LARGE', data);
	}
}

// Rate limit exceeded HTTP error
class RateLimitExceeded extends MoleculerClientError {
	constructor(type, data) {
		super('Rate limit exceeded', 429, type, data);
	}
}

// Service unavailable HTTP error
class ServiceUnavailableError extends MoleculerError {
	constructor(type, data) {
		super('Service unavailable', 503, type, data);
	}
}
// Service unavailable HTTP error
class RangeNotSatisfiableError extends MoleculerError {
	constructor(type, data) {
		super('Range Not Satisfiable', 416, type, data);
	}
}

module.exports = {
	InvalidRequestBodyError,
	InvalidResponseTypeError,
	UnAuthorizedError,
	ForbiddenError,
	BadRequestError,
	NotFoundError,
	PayloadTooLarge,
	RateLimitExceeded,
	ServiceUnavailableError,
	RangeNotSatisfiableError
};