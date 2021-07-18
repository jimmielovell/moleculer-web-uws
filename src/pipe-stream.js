'use strict';

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function onAbortedOrFinishedResponse(res, readStream) {
  if (!res.done) readStream.destroy();
  res.done = true;
}

function pipeStream(res, readStream, totalSize) {
  readStream.on('data', (chunk) => {
    const ab = toArrayBuffer(chunk);
    // Store where we are, globally, in our response
    let lastOffset = res.getWriteOffset();
    let [ok, done] = res.tryEnd(ab, totalSize);

    if (done) {
      onAbortedOrFinishedResponse(res, readStream);
    } else if (!ok) {
      readStream.pause();
      res.ab = ab; // Save unsent chunk for when we can send it
      res.abOffset = lastOffset;

      /* Register async handlers for drainage */
      res.onWritable((offset) => {
        let [ok, done] = res.tryEnd(res.ab.slice(offset - res.abOffset), totalSize);
        if (done) {
          onAbortedOrFinishedResponse(res, readStream);
        } else if (ok)
          readStream.resume();

        return ok;
      });
    }

  }).on('error', (err) => {
    readStream.destroy();
    res.end();
  });

  res.onAborted(() => {
    onAbortedOrFinishedResponse(res, readStream);
  });
}

module.exports = pipeStream;
