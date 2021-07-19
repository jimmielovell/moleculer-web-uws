'use strict';

const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const minimatch = require('minimatch');
const { NotFoundError, ForbiddenError, RangeNotSatisfiableError } = require('./errors');
const { isObject } = require('./utils');
const fresh = require('./fresh');

module.exports = {
  name: 'staticserver',

  settings: {
    rest: '/assets',
    folder: '/assets',
    cache: false,
    headers: {},
    etag: false,
  },

  actions: {
    serve: {
      rest: {
        path: '/:pathname',
        passReqRes: true
      },
      params: {
        pathname: 'string'
      },

      handler(ctx) {
        const pathname = this.resolve(ctx.params.pathname);

        if (pathname.indexOf('\0') !== -1)
          throw new ForbiddenError();
        if (pathname.indexOf(this.settings.root) !== 0)
          throw new ForbiddenError();

        try {
          const stat = fs.statSync(pathname);
          if (stat.isFile()) { // Stream a single file.
            ctx.meta.$responseHeaders = {};
            return this.respond(pathname, stat, ctx);
          } else {
            throw new NotFoundError();
          }
        } catch (err) {
          console.log(err)
          throw new NotFoundError();
        }
      }
    },
  },

  methods: {
    resolve(pathname) {
      return path.resolve(path.join(this.settings.root, pathname));
    },

    respond(file, stat, ctx) {
      const contentType = mime.lookup(file) || 'application/octet-stream';

      if (isObject(this.settings.cache))
        this.setCacheHeader(file, ctx);

      if (this.settings.gzip)
        return this.respondGzip(contentType, file, stat, ctx);
      else
        return this.respondUncompressed(contentType, file, stat, ctx);
    },

    respondGzip(contentType, file, stat, ctx) {
      if (this.gzipOk(req, contentType)) {
        const gzFile = file + '.gz';
        try {
          const gzStat = fs.statSync(pathname);
          if (gzStat.isFile()) {
            const vary = res.getHeader('Vary');
            ctx.meta.$responseHeaders['Vary'] = (vary && vary != 'Accept-Encoding' ? vary + ', ' : '') + 'Accept-Encoding';
            ctx.meta.$responseHeaders['Content-Encoding'] = 'gzip';
            stat = gzStat;
            file = gzFile;
          } else {
            throw new NotFoundError();
          }
        } catch (err) {
          throw new NotFoundError();
        }
      }

      return this.respondUncompressed(contentType, file, stat, ctx);
    },

    respondUncompressed(contentType, file, stat, ctx) {
      let size = stat.size;
      const mtime = stat.mtime;
      const $req = ctx.meta.$req;
      const rangeHeader = $req.headers['range'];

      if (isObject(this.settings.headers)) {
        for (let i = 0, keys = Object.keys(this.settings.headers); i < keys.length; i++) {
          ctx.meta.$responseHeaders[keys[i]] = this.settings.headers[keys[i]];
        }
      }

      ctx.meta.$responseHeaders['Last-Modified'] = mtime.toUTCString();
      ctx.meta.$responseHeaders['Date'] = (new Date()).toUTCString();

      let range = {};
      if (rangeHeader) {
        range = this.parseRange(rangeHeader, size)[0];
        ctx.meta.$statusCode = 206;
        ctx.meta.$responseHeaders['Accept-Ranges'] = 'bytes';
        ctx.meta.$responseHeaders['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
      } else {
        if (this.settings.etag) {
          const etag = `${stat.ino}-${stat.size}-${mtime.getTime()}`;
          ctx.meta.$responseHeaders['ETag'] = etag;
        }
        if (fresh($req.headers, ctx.meta.$responseHeaders)) {
          ctx.meta.$statusCode = 304;
          return null;
        }
      }

      ctx.meta.$responseHeaders['Content-Type'] = contentType;
      const fileStream = fs.createReadStream(file, {
        start: range.start,
        end: range.end
      });
      size = range.end ? range.end - range.start : size;
      ctx.meta.$byteLength = size;

      return fileStream;
    },

    gzipOk(req, contentType) {
      const enable = this.settings.gzip;

      if (enable === true || (contentType && (enable instanceof RegExp) && enable.test(contentType))) {
        const acceptEncoding = req.headers['accept-encoding'];
        return acceptEncoding && acceptEncoding.includes('gzip');
      }

      return false;
    },

    parseRange(rangeHeader, size) {
      if (rangeHeader.indexOf('bytes=') === -1)
        return false;

      let arr = rangeHeader.slice(6).split(',')
      let ranges = [];

      for (let i = 0, len = arr.length; i < len; i++) {
        let range = arr[i].split('-')
        let start = parseInt(range[0], 10)
        let end = parseInt(range[1], 10)

        if (isNaN(start)) {
          start = size - end;
          end = size - 1;
        } else if (isNaN(end))
          end = size - 1;

        if (end > size - 1)
          end = size - 1;

        if (isNaN(start) || isNaN(end) || start > end || start < 0)
          continue;

        ranges.push({
          start: start,
          end: end
        });
      }

      if (ranges.length < 1)
        throw new RangeNotSatisfiableError();

      return ranges;
    },

    setCacheHeader(file, ctx) {
      const cacheValue = this.getCacheValue(file);
      if (typeof(cacheValue) === 'number')
        ctx.meta.$responseHeaders['Cache-Control'] = 'max-age=' + cacheValue;
      else if (typeof(cacheValue) === 'string')
        ctx.meta.$responseHeaders['Cache-Control'] = cacheValue;
    },

    getCacheValue(pathname) {
      for (let i = 0, keys = Object.keys(this.settings.cache); i < keys.length; i++) {
        if (minimatch(pathname, keys[i]))
          return this.settings.cache[keys[i]];
      }

      return false;
    }
  },

  created() {
    if (!this.settings.root) {
      const cwd = process.cwd();
      console.log(cwd)
      this.settings.root = path.join(cwd, this.settings.folder);
    }

    this.settings.root = path.normalize(path.resolve(this.settings.root || '.'));
  }
}