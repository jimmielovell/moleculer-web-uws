'use strict';

const { BadRequestError } = require('./errors');
const { addSlashes, normalizePath } = require('./utils');

const charCodes = {
  '*': 0x2a,
  ':': 0x3a,
  '/': 0x2f,
}
const escape = {
  [charCodes['*']]: '(.*)',
  [charCodes['/']]: '\\/',
};

function parse(input) {
  input = normalizePath(addSlashes(input));
  let pattern = '^';
  let url = '';
  let param = -1;
  const keys = [];
  const len = input.length;

  for (let i = 0; i < len; i++) {
    const char = input.charCodeAt(i);

    if (char === charCodes[':'])// Colon
      param = i + 1;
    else if (param !== -1) {
      const isDelimiter = char === charCodes['/']; // Slash
      const isEnd = i === len - 1;
      if (isDelimiter || isEnd) {
        keys.push(input.slice(param, isEnd && !isDelimiter ? len : i));
        pattern += '([\\w-_+.]+?)' + (isDelimiter ? escape[char] : '');
        url += '*/';
        param = -1;
      }
    } else {
      const n = escape[char];
      pattern += n ? n : input[i];
      url += input[i];
    }
  }
  pattern += '$';

  return {
    regexp: new RegExp(pattern),
    keys,
    url
  };
}

function PathToRegExp(path) {
  const {regexp, keys, url} = parse(path);
  this.regexp = regexp;
  this.keys = keys;
  this.url = url;
}

PathToRegExp.prototype.match = function(url) {
  url = normalizePath(addSlashes(url));
  try {
    url = decodeURIComponent(url);
  } catch (err) {
    throw new BadRequestError();
  }

  const matches = this.regexp.exec(url);
  const params = {};

  if (matches === null) return null;

  for (let i = 1; i < matches.length; i++) {
    const value = matches[i];
    const _value = parseInt(value, 10);

    if (value) {
      if (isNaN(_value))
        params[this.keys[i - 1]] = value;
      else
        params[this.keys[i - 1]] = _value;
    }
  }

  return params;
}

module.exports = PathToRegExp;
