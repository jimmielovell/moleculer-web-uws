'use strict'

const { getParts } = require('uWebSockets.js');
const { Readable } = require('stream');

function multipart(req, res, opts = {}) {
  const partsLimit = Number(opts.parts || 0);
  const fieldsLimit = Number(opts.fields || 0);
  const filesLimit = Number(opts.files || 0);
  const fileSizeLimit = Number(opts.fileSize || 0);

  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'];
    let buffer;
    let fields = {};
    let files = [];
    let fileSizeLimitExceeded = false;
    let filesLimitExceeded = false;
    let fieldsLimitExceeded = false;
    let partsLimitExceeded = false;
    let numOfFiles = 0;
    let numOfFields = 0;

    res.onData((chunk, isLast) => {
      const curBuf = Buffer.from(chunk);
      buffer = buffer ? Buffer.concat([buffer, curBuf]) : isLast ? curBuf : Buffer.concat([curBuf]);

      if (isLast) {
        if (!buffer)
          return reject(new Error('No form data recieved.'));

        const parts = getParts(buffer, contentType);
        const partsLen = parts.length;

        if (0 < partsLimit && partsLimit > partsLen)
          partsLimitExceeded = true;

        if (!parts)
          return reject(new Error('Could not parse form data content. Maybe incorrect Content-Type.'));

        for (let i = 0; i < partsLen; i++) {
          let { name, data, type, filename } = parts[i];

          if (filename) {
            const fileSize = data.byteLength;
            if (0 < fileSize && fileSize > fileSizeLimit)
              fileSizeLimitExceeded = true;

            data = Readable.from(Buffer.from(data));
            files[numOfFiles] = { name, data, type, filename };
            numOfFiles++;
          } else {
            try {
              data = JSON.parse(Buffer.from(data).toString());
            } catch(err) {
              data = Buffer.from(data).toString();
            }

            fields[name] = data;
            numOfFields++;
          }
        }

        if (0 < filesLimit && filesLimit > numOfFiles)
          filesLimitExceeded = true;
        if (0 < fieldsLimit && fieldsLimit > numOfFields)
          fieldsLimitExceeded = true;

        return resolve({
          fields,
          files,
          fileSizeLimitExceeded,
          filesLimitExceeded,
          fieldsLimitExceeded,
          partsLimitExceeded
        })
      }
    })
  });
}

module.exports = multipart;
