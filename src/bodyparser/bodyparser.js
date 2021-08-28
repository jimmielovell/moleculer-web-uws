'use strict';

const Readable = require('stream').Readable;

function urlencoded(buffer) {
  const parsed = {};
  const encoded = buffer.toString();
  const pairs = encoded.split('&');

  for (let i = 0, len = pairs.length; i < len; i++) {
    let k = pairs[i].split('=');
    parsed[k[0]] = k[1];
  }

  return parsed;
}

function json(buffer) {
  buffer = buffer.toString();

  try {
    buffer = JSON.parse(buffer);
  } catch (err) {}

  return buffer;
}

function text(buffer) {
  return buffer.toString();
}

function raw(buffer) {
  return buffer;
}

function stream(buffer) {
  return Readable.from(buffer);
}

function typeParser(parser) {
  return function(req, res) {
    return new Promise((resolve, reject) => {
      let buffer;

      res.onData((chunk, isLast) => {
        const curBuf = Buffer.from(chunk);
        buffer = buffer ? Buffer.concat([buffer, curBuf]) : isLast ? curBuf : Buffer.concat([curBuf]);

        if (isLast) {
          try {
            resolve(parser(buffer));
          } catch (err) {
            reject(err);
            res.close();
          }
        }
      });
    })
  }
}

function autoParser(req, res) {
  const contentType = req.headers['content-type'];
  let parser;
  switch(contentType) {
    case 'application/json':
    case 'text/json':
      parser = json;
      break;
    case 'application/x-www-form-urlencoded':
      parser = urlencoded;
      break;
    case 'application/octet-sream':
      parser = raw;
      break;
    default:
      parser = text;
  }

  return typeParser(parser)(req, res);
}

const bodyParser = {
  json: typeParser(json),
  urlencoded: typeParser(urlencoded),
  text: typeParser(text),
  raw: typeParser(raw),
  stream: typeParser(stream)
}

module.exports = {
  bodyParser,
  autoParser
}
