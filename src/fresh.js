'use strict'

// Based on: https://github.com/jshttp/fresh

// RegExp to check for no-cache token in Cache-Control.
const CACHE_CONTROL_NO_CACHE_REGEXP = /(?:^|,)\s*?no-cache\s*?(?:,|$)/

function fresh(reqHeaders, resHeaders) {
  const modifiedSince = reqHeaders['if-modified-since'];
  const noneMatch = reqHeaders['if-none-match'];

  // Unconditional request
  if (!modifiedSince && !noneMatch) return false

  // Always return stale when Cache-Control: no-cache
  // to support end-to-end reload requests
  // https://tools.ietf.org/html/rfc2616#section-14.9.4
  const cacheControl = reqHeaders['cache-control'];
  if (cacheControl && CACHE_CONTROL_NO_CACHE_REGEXP.test(cacheControl))
    return false

  // if-none-match
  if (noneMatch && noneMatch !== '*') {
    const etag = resHeaders['ETag'];

    if (!etag) return false;

    let etagStale = true;
    const matches = parseTokenList(noneMatch);

    for (let i = 0; i < matches.length; i++) {
      let match = matches[i];

      if (match === etag || match === 'W/' + etag || 'W/' + match === etag) {
        etagStale = false;
        break
      }
    }

    if (etagStale) return false;
  }

  // if-modified-since
  if (modifiedSince) {
    const lastModified = resHeaders['Last-Modified'];
    const modifiedStale = !lastModified || !(parseHttpDate(lastModified) <= parseHttpDate(modifiedSince))

    if (modifiedStale) return false;
  }

  return true
}

function parseHttpDate(date) {
  const timestamp = date && Date.parse(date);

  return typeof timestamp === 'number' ? timestamp : NaN;
}

function parseTokenList(str) {
  let end = 0;
  let list = [];
  let nextListItemIdx = 0;
  let start = 0;

  for (let i = 0, len = str.length; i < len; i++) {
    if (str.charCodeAt(i) === 0x20 && start === end)
      start = end = i + 1;
    else if (str.charCodeAt(i) === 0x2c) {
      list[nextListItemIdx] = str.substring(start, end);
      start = end = i + 1;
      nextListItemIdx++;
    } else
      end = i + 1;
  }

  list[nextListItemIdx] = str.substring(start, end);

  return list;
}

module.exports = fresh;
