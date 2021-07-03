'use strict';

const fs = require('fs');
const path = require('path');
const mime  = require('mime-types');
const { brotliCompressSync }  = require('zlib');
const pipeStream = require('./pipe-stream');

function getRootPath() {
  let cd = __dirname;

  return cd
}

const compressibleSet = new Set(['.ico', '.js', '.json', '.html']);
function isCompressible(pathname) {
  const ext = path.extname(pathname);

  return compressibleSet.has(ext);
}

class StaticFileMeta {
  constructor(pathname, cacheFile) {
    this.pathname = pathname;
    const {mtime, size} = fs.statSync(pathname);
    this.mtime = mtime.toUTCString();
    this.size = size;
    const ext = path.extname(pathname).slice(1);
    this.type = mime.types[ext];

    if (cacheFile) {
      this.file = fs.readFileSync(pathname);

      if (isCompressible(pathname))
        this.brotliFile = brotliCompressSync(this.file);
    }
  }
}

function makePathnames(dirname, pathnames, prefix) {
  fs.readdirSync(dirname, {withFileTypes: true}).forEach((dirent) => {
    if (dirent.isFile()) {
      const key = prefix + dirent.name
      pathnames[key] = path.join(dirname, dirent.name)
    } else if (dirent.isDirectory())
      makePathnames(path.join(dirname, dirent.name), pathnames, `${prefix}${dirent.name}/`)
  })
}

class StaticServer {
  constructor(staticPaths, options) {
    const {filesToCache} = options;
    this.cachedFileSet = new Set(filesToCache);
    Object.keys(staticPaths).forEach((dirname) => {
      if (!staticPaths[dirname]) return

      try {
        if (!fs.existsSync(dirname)) fs.mkdirSync(dirname);

        makePathnames(dirname, this.pathnames, '');
      } catch (e) {
        console.log(e)
      }
    })
  }

  getMeta(filename) {
    const existingMeta = this.meta[filename];
    if (existingMeta) return existingMeta;

    const pathname = this.pathnames[filename];
    if (!pathname) return false;

    const cacheFile = this.cachedFileSet.has(filename);

    return (this.meta[filename] = new StaticFileMeta(pathname, cacheFile))
  }
}

const ROOT_PATH = getRootPath();

function serveStatic(staticDirs, opts) {
  staticDirs = Array.isArray(staticDirs)? staticDirs : [staticDirs];
  const staticPaths = {};

  staticDirs.forEach(dir => {
    staticPaths[path.join(ROOT_PATH, dir)] = true
  });

  const staticServer = new StaticServer(staticPaths, opts);

  return (req, res) => {
    const filename = req.getUrl().slice(1);
    const meta = staticServer.getMeta(filename);

    if (!meta) return false;

    const {size, pathname, brotliFile, file, type} = meta

    if (file) {
      res.cork(() => {
        res.setHeader('Content-Type', type)
        if (req.headers['accept-encoding'].includes('br') && brotliFile) {
          res.setHeader('Content-Encoding', 'br');
          res.end(brotliFile);
        } else res.end(file);
      });

      return true;
    }

    res.setHeader('Content-Type', type);
    const readStream = fs.createReadStream(pathname);
    pipeStream(res, readStream, size);

    return true;
  }
}

module.exports = serveStatic
