'use strict';

const pipeStream = (res, readStream, totalSize) => {
  res.onAborted(() => {
    readStream.destroy();
    res.done = true;
  });

  readStream
  .on('data', (chunk) => {
    if (res.done) {
      readStream.destroy();
      return
    }

    const ab = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
    const lastOffset = res.getWriteOffset();
    const [ok, done] = res.tryEnd(ab, totalSize);

    if (done) readStream.destroy();
    if (ok) return

    // backpressure found!
    readStream.pause();
    // save the current chunk & its offset
    res.ab = ab;
    res.abOffset = lastOffset;

    // set up a drainage
    res.onWritable(offset => {
      const [ok, hasResponded] = res.tryEnd(res.ab.slice(offset - res.abOffset), totalSize);

      if (hasResponded) readStream.destroy()
      else if (ok) readStream.resume();

      return ok
    })
  })
  .on('error', () => {
    if (!res.done) {
      res.statusCode = 500
      res.end();
    }

    readStream.destroy()
  });
}

module.exports = pipeStream;
