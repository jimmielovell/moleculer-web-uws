'use strict'

/**
 * RegExp to check for no-cache token in Cache-Control.
 * @private
 */
const CACHE_CONTROL_NO_CACHE_REGEXP = /(?:^|,)\s*?no-cache\s*?(?:,|$)/

function fresh(req, res) {
  const modifiedSince = req.headers['if-modified-since'];
  const noneMatch = req.headers['if-none-match'];

  // unconditional request
  if (!modifiedSince && !noneMatch) return false

  // Always return stale when Cache-Control: no-cache
  // to support end-to-end reload requests
  // https://tools.ietf.org/html/rfc2616#section-14.9.4
  const cacheControl = req.headers['cache-control'];
  if (cacheControl && CACHE_CONTROL_NO_CACHE_REGEXP.test(cacheControl))
    return false

  // if-none-match
  if (noneMatch && noneMatch !== '*') {
    const etag = res.getHeader['ETag'];

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
    const lastModified = res.getHeader('Last-Modified');
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
  let start = 0;

  // gather tokens
  for (let i = 0, len = str.length; i < len; i++) {
    switch (str.charCodeAt(i)) {
      case 0x20: /*   */
        if (start === end)
          start = end = i + 1;
        break
      case 0x2c: /* , */
        list.push(str.substring(start, end));
        start = end = i + 1;
        break
      default:
        end = i + 1;
        break
    }
  }

  list.push(str.substring(start, end));

  return list;
}

module.exports = fresh;
