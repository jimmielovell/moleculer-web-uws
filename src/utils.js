'use strict';

const fresh	= require('./fresh');
const etag	= require('etag');
const { BadRequestError, ERR_UNABLE_DECODE_PARAM } = require('./errors');
const { MoleculerError } = require('moleculer').Errors;

function isObject(obj) {
	return obj !== null && typeof obj === 'object';
}

function isFunction(o) {
	return typeof o === 'function';
}

function isString(obj) {
	return typeof obj === 'string'
}

function isNumber(obj) {
	return typeof obj === 'number';
}

function isRegExp(obj) {
	return obj instanceof RegExp;
}

function debounce(fn, delay) {
	let timerId

	return (...args) => {
		if (!timerId)
			fn(...args);

		clearTimeout(timerId)

		timerId = setTimeout(() => fn(...args), delay)
	}
}

/**
 * Decode URI encoded param
 * @param {String} param
 */
function decodeParam(param) {
	try {
		return decodeURIComponent(param);
	} catch (err) {
		throw new BadRequestError(ERR_UNABLE_DECODE_PARAM, { param });
	}
}

// Remove slashes '/' from the left & right sides and remove double '//' slashes
function removeTrailingSlashes(s) {
	if (s[0] === '/')
		s = s.slice(1);
	if (s[s.length - 1] === '/')
		s = s.slice(0, -1);
	return s; //.replace(/\/\//g, '/');
}

// Add slashes '/' to the left & right sides
function addSlashes(s) {
	return (s[0] === '/' ? '' : '/') + s + (s[s.length - 1] === '/' ? '' : '/');
}

// Normalize URL path (remove multiple slashes //)
function normalizePath(s) {
	return s.replace(/\/{2,}/g, '/');
}

/**
 * Compose middlewares
 *
 * @param {...Function} mws
 */
function compose(...mws) {
	const self = this;

	return (req, res, done) => {
		const next = (i, err) => {
			if (i >= mws.length) {
				if (isFunction(done))
					return done.call(self, err);

				return;
			}

			if (err) {
				// Call only error middlewares (err, req, res, next)
				if (mws[i].length == 4)
					mws[i].call(self, err, req, res, err => next(i + 1, err));
				else
					next(i + 1, err);
			} else {
				if (mws[i].length < 4)
					mws[i].call(self, req, res, err => next(i + 1, err));
				else
					next(i + 1);
			}
		};

		return next(0);
	};
}

/**
 * Compose middlewares and return Promise
 * @param {...Function} mws
 * @returns {Promise}
 */
function composeThen(req, res, ...mws) {
	return new Promise((resolve, reject) => {
		compose.call(this, ...mws)(req, res, err => {
			if (err) {
				if (err instanceof MoleculerError)
					return reject(err);

				if (err instanceof Error)
					return reject(new MoleculerError(err.message, err.code || err.status, err.type));

				return reject(new MoleculerError(err));
			}

			resolve();
		});
	});
}

/**
 * Generate ETag from content.
 *
 * @param {any} body
 * @param {Boolean|String|Function?} opt
 *
 * @returns {String}
 */
function generateETag(body, opt) {
	if (isFunction(opt))
		return opt.call(this, body);

	let buf = !Buffer.isBuffer(body)
		? Buffer.from(body)
		: body;

	return etag(buf, (opt === true || opt === 'weak') ? { weak: true } : null);
}

/**
 * Check the data freshness.
 *
 * @param {*} req
 * @param {*} res
 *
 * @returns {Boolean}
 */
function isFresh(req, res) {
	if ((res.statusCode >= 200 && res.statusCode < 300) || 304 === res.statusCode)
		return fresh(req, res);

	return false;
}

module.exports = {
	isObject,
	isFunction,
	debounce,
	isString,
	isNumber,
	isRegExp,

	removeTrailingSlashes,
	addSlashes,
	normalizePath,

	decodeParam,

	compose,
	composeThen,

	generateETag,
	isFresh
};