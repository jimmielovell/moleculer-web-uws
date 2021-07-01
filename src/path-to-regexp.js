'use strict';

const CHARS = {
  ASTERIKS: 42,
  COLON: 58,
  SLASH: 47,
}

const escape = {
  [CHARS.ASTERIKS]: '(.*)',
  [CHARS.SLASH]: '\\/',
};

function parse(input) {
  input = normalize(input);
  let pattern = '^';
  let url = '';

  const keys = [];
  let param = -1;
  const len = input.length;

  for (let i = 0; i < len; i++) {
    const char = input.charCodeAt(i);

    if (char === CHARS.COLON)
      param = i + 1;
    else if (param !== -1) {
      const isDelimiter = char === CHARS.SLASH;
      const isEnd = i === len - 1;
      if (isDelimiter || isEnd) {
        keys.push(input.slice(param, isEnd && !isDelimiter ? len : i));
        pattern += '([\\w-_+.]+)' + (isDelimiter ? escape[char] : '');
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

function normalize(url) {
  return ('/' + url + '/').replace(/\/{2,}/g, '/');
}

function PathToRegExp(path) {
  const {regexp, keys, url} = parse(path);
  this.regexp = regexp;
  this.keys = keys;
  this.url = url;
}

PathToRegExp.prototype.match = function(url) {
  url = normalize(url);
  const matches = this.regexp.exec(url);

  if (matches === null) return null;

  const params = {};

  for (let i = 1; i < matches.length; i++) {
    const value = matches[i];

    if (value)
      params[this.keys[i - 1]] = value;
  }

  return params;
}

module.exports = PathToRegExp;
