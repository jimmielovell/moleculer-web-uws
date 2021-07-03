'use strict';

const fresh	= require('./fresh');
const etag	= require('etag');
const { BadRequestError, ERR_UNABLE_DECODE_PARAM } = require('./errors');

function isObject(obj) {
	return obj !== null && typeof obj === 'object';
}

function isFunction(obj) {
	return typeof obj === 'function';
}

function isString(obj) {
	return typeof obj === 'string'
}

function isNumber(obj) {
	return typeof obj === 'number';
}

function isStream(obj) {
	return isObject(obj) && isFunction(obj.pipe);
}

function isReadableStream(stream) {
	return isStream(stream) &&
		stream.readable !== false &&
		isFunction(stream._read) &&
		isObject(stream._readableState);
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

// Remove slashes '/' from the left & right sides
function removeTrailingSlashes(s) {
	if (s[0] === '/')
		s = s.slice(1);
	if (s[s.length - 1] === '/')
		s = s.slice(0, -1);
	return s;
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
	isString,
	isNumber,
	isReadableStream,

	removeTrailingSlashes,
	addSlashes,
	normalizePath,

	decodeParam,

	generateETag,
	isFresh
};