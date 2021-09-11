'use strict';

const Readable = require('stream').Readable;

const parsers = {
  json: (buffer) => {
    buffer = buffer.toString();

    try {
      buffer = JSON.parse(buffer);
    } catch (err) {}

    return buffer;
  },

  urlencoded: (buffer) => {
    const parsed = {};
    let decoded = buffer.toString();

    try {
      decoded = decodeURIComponent(decoded);
    } catch(err) {}

    const pairs = decoded.split('&');

    for (let i = 0, len = pairs.length; i < len; i++) {
      let k = pairs[i].split('=');
      parsed[k[0]] = k[1];
    }

    return parsed;
  },

  text: (buffer) => {
    return buffer.toString();
  },

  stream: (buffer) => {
    return Readable.from(buffer);
  }
}

function bodyParser(parser, req, res) {
  let fnParser;
  let buffer;
  const contentType = req.headers['content-type'];

  if (parser === 'any') {
    if (contentType) {
      if (contentType.indexOf('json') !== -1)
        fnParser = parsers['json'];
      else if (contentType.indexOf('text') !== -1)
        fnParser = parsers['text'];
      else if (contentType.indexOf('urlencoded') !== -1)
        fnParser = parsers['urlencoded'];
    }
  } else
    fnParser = parsers[parser];

  return new Promise((resolve, reject) => {
    res.onData((chunk, isLast) => {
      chunk = Buffer.from(chunk);

      if (isLast) {
        buffer = buffer ? Buffer.concat([buffer, chunk]) : chunk;

        try {
          resolve(fnParser ? fnParser(buffer) : buffer);
        } catch (err) {
          res.close();
          reject(err);
        }
      } else
        buffer = buffer ? Buffer.concat([buffer, chunk]) : Buffer.concat([chunk]);
    });

    res.onAborted(() => { reject(null) });
  })
}

module.exports = bodyParser
