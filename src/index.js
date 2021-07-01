const uws = require('uWebSockets.js');
const isReadableStream = require('is-stream').readable;
const { MoleculerError, MoleculerServerError, MoleculerClientError, ServiceNotFoundError } = require('moleculer').Errors;
const { ServiceUnavailableError, NotFoundError, ForbiddenError, RateLimitExceeded, UnAuthorizedError } = require('./errors');
const { autoParser, bodyParser } = require('./body-parser/body-parser');
const multipart = require('./body-parser/multipart');
const serveStatic = require('./serve-static');
const PathToRegExp = require('./path-to-regexp');
const { isObject, isFunction, isString, isNumber, normalizePath, generateETag, isFresh } = require('./utils');

function getServiceFullname(svc) {
	if (svc.version != null && svc.settings.$noVersionPrefix !== true)
		return (typeof (svc.version) == 'number' ? 'v' + svc.version : svc.version) + '.' + svc.name;

	return svc.name;
}

/**
 * uWS API Gateway service for Moleculer microservices framework.
 *
 * Based on: https://github.com/moleculerjs/moleculer-web
 * @service
 */
 module.exports = {
	name: 'api',

	settings: {
		assets: false,

		port: process.env.PORT || 3000,

		cors: true,

		rateLimit: false,

		logging: true,

		// Log each request (default to 'info' level)
		logRequest: 'info',

		// Log the request ctx.params (default to 'debug' level)
		logRequestParams: 'debug',

		// Log each response (default to 'info' level)
		logResponse: 'info',

		// Log the response data (default to disable)
		logResponseData: null,

		// If set to true, it will log 4xx client errors, as well
		log4XXResponses: false,

		// Log the route registration related activity
		logRouteRegistration: 'info',
	},

	metadata: {
		$category: 'gateway',
		$description: 'uWs API Gateway service',
		$official: false
	},

	actions: {
		/**
		 * REST request handler
		 */
		rest: {
			visibility: 'private',
			tracing: {
				tags: {
					params: [
						'req.url',
						'req.method'
					]
				},
				spanName: ctx => `${ctx.params.req.method} ${ctx.params.req.url}`
			},
			timeout: 0,
			handler(ctx) {
				const req = ctx.params.req;
				const res = ctx.params.res;
				const route = req.$route;

				const endpoint = this.broker.findNextActionEndpoint(route.action, route.callOptions, ctx);
				if (endpoint instanceof Error) {
					if (endpoint instanceof ServiceNotFoundError)
						throw new ServiceUnavailableError();

					throw endpoint;
				}
				req.$endpoint = endpoint;
				// Set pointers to Context
				req.$ctx = ctx;
				res.$ctx = ctx;

				return this.routeHandler(req, res);
			}
		},

		listRoutes: {
			// rest: 'GET /list-routes',
			params: {
				grouping: { type: 'boolean', optional: true, convert: true },
				withActionSchema: { type: 'boolean', optional: true, convert: true }
			},
			handler(ctx) {
				const grouping = !!ctx.params.grouping;
				const withActionSchema = !!ctx.params.withActionSchema;

				const actionList = withActionSchema ? this.broker.registry.getActionList({}) : null;

				const res = [];

				return res;
			}
		},
	},

	methods: {
		createServer() {
			if (this.server) return;

			if (this.settings.https && this.settings.https.key && this.settings.https.cert) {
				this.server = uws.SSLApp({
					key_file_name: this.settings.https.key,
    			cert_file_name: this.settings.https.cert,
				});
				this.isHTTPS = true;
			} else {
				this.server = uws.App();
				this.isHTTPS = false;
			}
		},

		listenServer() {
			this.server.listen(this.settings.port, listenSocket => {
				if (!listenSocket)
					throw new MoleculerServerError(`Port ${this.settings.port} is in use!`);

				this.server.listening = true;
				this.server.listenSocket = listenSocket;

				// const addr = this.server.address();
				// const listenAddr = this.settings.ip == '0.0.0.0' && os.platform() == 'win32' ? 'localhost' : this.settings.ip;
				this.logger.info(`API Gateway listening on PORT ${this.settings.port}`);
			});
		},

		async routeHandler(req, res) {
			const route = req.$route;
			const ctx = req.$ctx;
			let params = {};

			// CORS headers
			if (this.settings.cors)
				this.writeCorsHeaders(req, res);

			// Rate limiter
			if (this.settings.rateLimit && isObject(this.settings.rateLimit)) {
				const opts = this.settings.rateLimit;
				const store = this.settings.store;
				const key = opts.key(req);

				if (key) {
					const remaining = opts.limit - store.inc(key);
					if (opts.headers) {
						res.setHeader('X-Rate-Limit-Limit', opts.limit);
						res.setHeader('X-Rate-Limit-Remaining', Math.max(0, remaining));
						res.setHeader('X-Rate-Limit-Reset', store.resetTime);
					}
					if (remaining < 0) throw new RateLimitExceeded();
				}
			}

			const parsedQuery = this.parseQueryString(req.query);

			// ToDo: Enable parameter merge options
			if (route.regexp) {
				const namedParams = route.regexp.match(req.url);
				Object.assign(params, namedParams, parsedQuery);
			}

			if (route.multipart)
				return await this.multipartHandler(req, res);
			else
				req.body = await route.bodyParser(req, res);

			Object.assign(params, req.body);

			if (route.authenticate) {
				try {
					await this.authenticate(ctx, req, res);
				} catch (err) {
					throw new UnAuthorizedError();
				}
			}
			if (route.authorize) {
				try {
					await this.authorize(ctx, req, res);
				} catch (err) {
					throw new UnAuthorizedError();
				}
			}

			// onBeforeCall handling
			if (this.settings.onBeforeCall)
				await this.settings.onBeforeCall.call(this, ctx, req, res);

			return await this.callAction(route.action, req, res, params);
		},

		async callAction(actionName, req, res, params) {
			const ctx = req.$ctx;

			// Logging params
			if (this.settings.logging) {
				if (this.settings.logRequest && this.settings.logRequest in this.logger)
					this.logger[this.settings.logRequest](`Call '${actionName}' action`);
				if (this.settings.logRequestParams && this.settings.logRequestParams in this.logger)
					this.logger[this.settings.logRequestParams]('Params:', params);
			}

			// Pass the `req` & `res` vars to ctx.params.
			if (this.settings.passReqResToParams) {
				params.$req = req;
				params.$res = res;
			}

			const opts = this.settings.callOptions ? { ...this.settings.callOptions } : {};
			if (params && params.$params) {
				// Transfer URL parameters via meta in case of stream
				if (!opts.meta) opts.meta = { $params: params.$params };
				else opts.meta.$params = params.$params;
			}

			let data = await ctx.call(req.$endpoint, params, opts);

			if (data instanceof Error)
				return this.sendError(req, res, data);

			// onAfterCall handling
			if (this.settings.onAfterCall)
				data = await this.settings.onAfterCall.call(this, ctx, req, res, data);

			this.sendResponse(req, res, data, req.$endpoint.action);

			return true;
		},

    createRoutes() {
			const processedServices = new Set();
      const services = this.broker.registry.services.list({
        skipInternal: true,
				withActions: true
      });

			let service;
			const servicesLength = services.length;

			for (let i = 0; i < servicesLength; ++i) {
				service = services[i];
				const serviceName = getServiceFullname(service);
				if (processedServices.has(serviceName))
					continue;

				this.logger.info('Registering', serviceName, 'service routes');

				let servicePath = service.settings.rest && service.settings.rest !== ''
					? service.settings.rest
					: '/' + serviceName;
				// Replace periods incase the service is versioned
				servicePath = servicePath.replace(/\./g, '/');

				const actions = service.actions;
				let action = {}, _action;
				for (let i = 0, keys = Object.keys(actions); i < keys.length; i++) {
					_action = actions[keys[i]];
					if (!_action.rest || _action.visibility === 'private')
						continue;

					action.rest = _action.rest;
					action.name = _action.name;
					action.authenticate = _action.authenticate;
					action.authorize = _action.authorize;

					this.createRestRoute(action, servicePath)
				}

				processedServices.add(serviceName);
			}

			try {
				if (this.settings.assets)
					this.registerStaticRoute();

				this.registerPreflightRoute();
				this.register404Route();
				this.listenServer();
			} catch (err) {
				throw err;
			}
    },

		createRestRoute(action, servicePath) {
			const route = {};
			const rest = action.rest;

			let methodBpPath;
			if (isString(rest))
				methodBpPath = rest.split(' ');
			else if (isObject(rest)) {
				methodBpPath = rest.path || '';
				methodBpPath = methodBpPath.split(' ');
			} else
				return this.logger.error('InvalidRestDefinitionError: ');

			let method, bodyParserType, path;
			switch(methodBpPath.length) {
				case 3:
					method = methodBpPath[0];
					bodyParserType = methodBpPath[1];
					path = methodBpPath[2];
					break;
				case 2:
					method = methodBpPath[0];
					path = methodBpPath[1];
					break;
				case 1:
					method = methodBpPath[0];
					break;
				case 0:
					method = '*';
					break;
			}

			// Check for named parameters
			if (path.indexOf(':') > -1) {
				route.regexp = new PathToRegExp(servicePath + '/' + path);
				path = route.regexp.url;
			} else {
				// If path is not defined, resolve it to the action's name
				if (!path) path = action.name;
				path = servicePath + '/' + path;
				path = normalizePath(path);
			}
			route.path = path;

			if (method === '*')
				method = 'any';
			else {
				method = method.toLowerCase();
				if (method === 'delete')
					method = 'del';
			}

			if (!['get', 'post', 'del', 'put', 'options', 'head'].includes(method)) {
				this.logger.error('InvalidRestDefinitionError: Unsurpported method \'', method, '\'!');
				return;
			}
			route.method = method;
			route.action = action.name;

			if (rest.multipart || bodyParserType === 'multipart') {
				const opts = Object.assign({}, this.settings.multipartOptions, rest.multipart);
				route.multipart = opts;
				route.bodyParser = multipart;
			} else if (bodyParserType)
				route.bodyParser = bodyParser[bodyParserType];
			else
				route.bodyParser = autoParser;

			if (rest.authenticate) {
				if (!isFunction(this.authenticate))
					this.logger.error('Define \'authenticate\' method in the API Gateway to enable authentication.');
				route.authenticate = true;
			}
			if (rest.authorize) {
				if (!isFunction(this.authorize))
					this.logger.error('Define \'authorize\' method in the API Gateway to enable authentication.');
				route.authorize = true;
			}

			this.registerRestRoute(route);
		},

		registerRestRoute(route) {
			if (this.server) {
				let resolvedRoute;

				try {
					resolvedRoute = this.addRestRoute(route);
				} catch (err) {
					return this.logger.error('Cannot register route', route.path);
				}

				const completepath = this.createFullRoutePath(resolvedRoute.path);
				// Top Level Path
				const TLP_LENGTH = this.settings.path
					? this.settings.path.length - 1
					: 0

				this.server = this.server[route.method](completepath, async (res, _req) => {
					const headers = {};
					_req.forEach((key, value) => headers[key] = value);
					const req = {
						$startTime: process.hrtime(),
						url: _req.getUrl().substring(TLP_LENGTH),
						method: _req.getMethod().toUpperCase(),
						query: _req.getQuery(),
						$route: route,
						headers
					}
					res = this.patchHttpRes(res, req);

					const requestID = req.headers['x-correlation-id'] || req.headers['x-request-id'];
					if (requestID)
							res.setHeader('X-Request-Id', ctx.requestID);

					try {
						// if (this.settings.rootCallOptions) {
						// 	if (isObject(this.settings.rootCallOptions))
						// 		Object.assign(options, this.settings.rootCallOptions);
						// 	else if (isFunction(this.settings.rootCallOptions))
						// 		this.settings.rootCallOptions.call(this, options, req, res);
						// }
						await this.actions.rest({ req, res });

						if (!res.done)
							this.sendError(req, res, err);
					} catch (err) {
						// Clientside error logging
						if (this.settings.log4XXResponses && 400 < err.code && err.code < 500)
							this.logger.error('Request error!', err.name, ':', err.message, '\n', err.stack, '\nData:', err.data);
						return this.sendError(req, res, err);
					}
				});
			}
		},

		addRestRoute(route) {
			let {path, action, method} = route;
			// Check to see if route is already added
			// resolve all the middlewares
				// Find a way in which the mws can mutate the res object
				// BodyParser
				// Cors middleware
				// ...mws
				//

			if (this._routes[method]) {
				if (this._routes[method][path]) {
					this.logger.error(`Route '${method.toUpperCase()} path' already exists`)
					throw new Error();
				} else
					this._routes[method][path] = route;
			} else {
				this._routes[method] = {
					[path]: route,
				};
			}

			return route;
		},

		createFullRoutePath(path) {
			let completepath = this.settings.path
					? this.settings.path + '/' + path
					: path;
			completepath = normalizePath('/' + completepath);

			if (completepath.endsWith('/'))
				completepath = completepath.slice(0, -1);

			return completepath;
		},

		registerStaticRoute() {
			let path = this.settings.assets.path
				? '/' + this.settings.assets.path + '/*'
				: '/*';
			path = normalizePath(path);
			this.server = this.server.get(path, (res, _req) => {
				const headers = {}
				_req.forEach((key, value) => headers[key] = value);
				const req = {
					$startTime: process.hrtime(),
					url: _req.getUrl(),
					method: _req.getMethod().toUpperCase(),
					query: _req.getQuery(),
					headers
				}
				res = this.patchHttpRes(res, req);

				try {
					const done = this.serveStatic(req, res);
					if (!done)
						this.send404(req, res);

					if (!res.done)
						throw new Error();
				} catch (err) {
					res.statusCode = 500;
					res.end('Internal server error!');
				}
			});
		},

		registerPreflightRoute() {
			const completepath = this.createFullRoutePath('/*');
			this.server = this.server.options(completepath, (res, _req) => {
				const req = {
					$startTime: process.hrtime(),
					url: _req.getUrl(),
					method: _req.getMethod().toUpperCase(),
					headers: {
						origin: _req.getHeader('origin'),
						'access-control-request-method': _req.getHeader('access-control-request-method')
					}
				}
				res = this.patchHttpRes(res, req);

				try {
					if (this.settings.cors)
						this.writeCorsHeaders(req, res, true);

					if (req.headers['access-control-request-method']) {
						// 204 - No content
						res.statusCode = 204;
						res.setHeader('Content-Length', 0).end();
					}
				} catch (err) {
					res.statusCode = 500;
					res.end('Internal server error!');
				}
			});
		},

		// Register it as the last route to catch 404 requests
		register404Route() {
			this.server = this.server.any('/*', (res, _req) => {
				const req = { $startTime: process.hrtime(), url: _req.getUrl(), method: _req.getMethod().toUpperCase() }
				res = this.patchHttpRes(res, req);

				try {
					this.send404(req, res);
				} catch (err) {
					res.statusCode = 500;
					res.end('Internal server error!');
				}
			})
		},

		patchHttpRes(res, req) {
			res.onAborted(() => res.done = true);
			res.statusCode = 200;
			res._headers = new Map();
			res.setHeader = (key, value) => {
				res._headers.set(key+'', value+'');
				return res;
			}
			res.getHeader = (key) => {
				return res.headers.get(key);
			}
			res.removeHeader = (key) => {
				res.headers.delete(key);
				return res;
			}
			res._end = res.end
			res.end = (body) => {
				if (res.done) return;
				res.done = true;
				res.writeStatus((res.statusCode)+'');
				for (let [key, value] of res._headers) {
					res.writeHeader(key, value);
				}
				res._end(body);
				// Log the response if configured
				this.logResponse(req, res.statusCode, body);
			}

			return res;
		},

		writeCorsHeaders(req, res, isPreFlight) {
			const origin = req.headers['origin'];
			// It's not presented, when it's a local request (origin and target same)
			if (!origin) return;

			const cors = this.settings.cors;
			// Access-control-allow-origin
			if (!cors.origin || cors.origin === '*')
				res.setHeader('Access-Control-Allow-Origin',  '*');
			else if (this.checkOrigin(origin, cors.origin)) {
				res.setHeader('Access-Control-Allow-Origin', origin);
				res.setHeader('Vary', 'Origin');
			} else
				throw new ForbiddenError('ORIGIN_NOT_ALLOWED');

			// Access-Control-Allow-Credentials
			if (cors.credentials === true)
				res.setHeader('Access-Control-Allow-Credentials', 'true');

			// Access-Control-Expose-Headers
			if (isString(cors.exposedHeaders))
				res.setHeader('Access-Control-Expose-Headers', cors.exposedHeaders);
			else if (Array.isArray(cors.exposedHeaders))
				res.setHeader('Access-Control-Expose-Headers', cors.exposedHeaders.join(', '));

			if (isPreFlight) {
				// Access-Control-Allow-Headers
				if (isString(cors.allowedHeaders))
					res.setHeader('Access-Control-Allow-Headers', cors.allowedHeaders);
				else if (Array.isArray(cors.allowedHeaders))
					res.setHeader('Access-Control-Allow-Headers', cors.allowedHeaders.join(', '));
				else {
					// AllowedHeaders doesn't specified, so we send back from req headers
					const allowedHeaders = req.headers['access-control-request-headers'];
					if (allowedHeaders) {
						res.setHeader('Vary', 'Access-Control-Request-Headers');
						res.setHeader('Access-Control-Allow-Headers', allowedHeaders);
					}
				}

				// Access-Control-Allow-Methods
				if (isString(cors.methods))
					res.setHeader('Access-Control-Allow-Methods', cors.methods);
				else if (Array.isArray(cors.methods))
					res.setHeader('Access-Control-Allow-Methods', cors.methods.join(', '));

				// Access-Control-Max-Age
				if (cors.maxAge)
					res.setHeader('Access-Control-Max-Age', cors.maxAge.toString());
			}
		},

		async multipartHandler(req, res) {
			const ctx = req.$ctx;
			const route = req.$route;
			const multipartOptions = route.multipart;
			const result = await route.bodyParser(req, res, multipartOptions);
			const { fields, files } = result;
			const numOfFiles = files.length > 0;

			// Add limit event handlers
			if (result.fileSizeLimitExceeded && isFunction(multipartOptions.onFileSizeLimit))
				multipartOptions.onFileSizeLimit.call(this.service, file, result);
			if (result.partsLimitExceeded && isFunction(multipartOptions.onPartsLimit))
				multipartOptions.onPartsLimit.call(this.service, result, this, this.service);
			if (result.filesLimitExceeded && isFunction(multipartOptions.onFilesLimit))
				multipartOptions.onFilesLimit.call(this.service, result, this, this.service);
			if (result.fieldsLimitExceeded && isFunction(multipartOptions.onFieldsLimit))
				multipartOptions.onFieldsLimit.call(this.service, result, this, this.service);

			if (multipartOptions.empty === false && numOfFiles == 0)
				throw new MoleculerClientError('File missing in the request');

			ctx.meta.$multipart = fields;

			let data = await ctx.call(req.$endpoint, files.length > 1 ? files : files[0], {
				meta: { $multipart: fields }
			});

			const fileLimit = multipartOptions.files || null;

			if (numOfFiles == 1 && fileLimit == 1) {
				// Remove the array wrapping
				data = data[0];
			}

			if (route.onAfterCall)
				data = await route.onAfterCall.call(this, ctx, this.route, req, res, data);

			this.sendResponse(req, res, data, {});
		},

		encodeJsonResponse(data) {
			return JSON.stringify(data);
		},

		sendResponse(req, res, data) {
			const ctx = req.$ctx;
			const route = req.$route;

			// Custom status code from ctx.meta
			if (ctx.meta.$statusCode)
				res.statusCode = ctx.meta.$statusCode;

			// Redirect
			if (res.statusCode >= 300 && res.statusCode < 400 && res.statusCode !== 304) {
				const location = ctx.meta.$location;
				if (!location)
					this.logger.warn(`The 'ctx.meta.$location' is missing for status code '${res.statusCode}'!`);
				else
					res.setHeader('Location', location);
			}

			let responseType;
			// Custom responseType from ctx.meta
			if (ctx.meta.$responseType)
				responseType = ctx.meta.$responseType;

			// Custom headers from ctx.meta
			if (ctx.meta.$responseHeaders) {
				for (let i = 0, keys = Object.keys(ctx.meta.$responseHeaders); i < keys.length; i++) {
					res.setHeader(keys[i], ctx.meta.$responseHeaders[keys[i]]);
				}
			}

			if (data === null)
				return res.cork(() => res.end())

			let chunk;
			// Buffer
			if (Buffer.isBuffer(data)) {
				res.setHeader('Content-Type', responseType || 'application/octet-stream');
				res.setHeader('Content-Length', data.length);
				chunk = data;
			}
			// Buffer from Object
			else if (isObject(data) && data.type == 'Buffer') {
				const buf = Buffer.from(data);
				res.setHeader('Content-Type', responseType || 'application/octet-stream');
				res.setHeader('Content-Length', buf.length);
				chunk = buf;
			}
			// Stream
			else if (isReadableStream(data)) {
				res.setHeader('Content-Type', responseType || 'application/octet-stream');
				chunk = data;
			}
			// Other (stringify or raw text)
			else {
				if (!responseType) {
					res.setHeader('Content-Type', 'application/json; charset=utf-8');
					chunk = this.encodeJsonResponse(data);
				} else {
					res.setHeader('Content-Type', responseType);

					if (isString(data)) chunk = data;
					else chunk = data.toString();
				}
			}

			// Auto generate & add ETag
			if (this.settings.etag && chunk && !isReadableStream(chunk)) {
				res.setHeader('ETag', generateETag.call(this, chunk, route.etag));

				// Freshness
				if (isFresh(req, res))
					res.statusCode = 304;
			}

			if (res.statusCode === 204 || res.statusCode === 304) {
				res.removeHeader('Content-Type');
				res.removeHeader('Content-Length');
				res.removeHeader('Transfer-Encoding');
				res.cork(() => res.end());
			} else {
				if (req.method === 'HEAD')
					res.cork(() => res.end());
				else {
					if (isReadableStream(data))
						pipeStream(res, data, data.byteLength)
					else
						res.cork(() => res.end(chunk));
				}
			}
		},

		send404(req, res) {
			this.sendError(req, res, new NotFoundError());
		},

		sendError(req, res, err) {
			if (isFunction(this.settings.onError))
				return this.settings.onError.call(this, req, res, err);

			if (!err || !(err instanceof Error)) {
				res.statusCode = 500;
				res.end('Internal server error!');
				return;
			}

			if (!(err instanceof MoleculerError)) {
				const e = err;
				err = new MoleculerError(e.message, e.code || e.status, e.type, e.data);
				err.name = e.name;
			}

			const responseType = 'application/json; charset=utf-8';
			const statusCode = isNumber(err.code) && (400 < err.code && err.code < 599) ? err.code : 500;
			res.statusCode = statusCode;
			// Return with the error as JSON object
			const {name, message, code, type, data} = err;
			res.setHeader('Content-Type', responseType);
			res.end(err ? this.encodeJsonResponse({ name, message, code, type, data }) : 'Internal Server Error!');
		},

		parseQueryString(qs) {
			const params = {};

			if (qs) {
				const props = new URLSearchParams(qs);

				for (const [key, value] of props) {
					if (key.endsWith('[]'))
						params[key.slice(0, -2)] = props.getAll(key);
					else
						params[key] = value;
				}
			}

			return params;
		},

		logRequest(req) {
			if (!this.settings.logging) return;

			if (this.settings.logRequest && this.settings.logRequest in this.logger)
				this.logger[this.settings.logRequest](`=> ${req.method} ${req.url}`);
		},

		logResponse(req, statusCode, data) {
			if (!this.settings.logging) return;

			let time = '';
			if (req.$startTime) {
				const diff = process.hrtime(req.$startTime);
				const duration = (diff[0] + diff[1] / 1e9) * 1000;
				if (duration > 1000)
					time = `[+${Number(duration / 1000).toFixed(3)} s]`;
				else
					time = `[+${Number(duration).toFixed(3)} ms]`;
			}

			if (this.settings.logResponse && this.settings.logResponse in this.logger)
				this.logger[this.settings.logResponse](`<= ${statusCode} ${req.method} ${req.url} ${time}`);

			if (this.settings.logResponseData && this.settings.logResponseData in this.logger) {
				this.logger[this.settings.logResponseData]('  Data:', data);
			}
		},

		checkOrigin(origin, settings) {
			if (isString(settings)) {
				if (settings.indexOf(origin) !== -1)
					return true;

				if (settings.indexOf('*') !== -1) {
					// Based on: https://github.com/hapijs/hapi
					// eslint-disable-next-line
					const wildcard = new RegExp(`^${settings.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/\\\*/g, '.*').replace(/\\\?/g, '.')}$`);
					return origin.match(wildcard);
				}
			}

			return false;
		},
	},

	events: {
		// '$services.changed'() {
		// 	this.createRoutes();
		// },

    '$broker.started'() {
      this.createRoutes();
    }
	},

	created() {
		// Create a new HTTP/HTTPS server instance
		this.createServer();
		this.logger.info('API Gateway server created.');

		// Create static server
		if (this.settings.assets && this.settings.assets.enabled) {
			const opts = this.settings.assets;
			this.serveStatic = serveStatic(opts.folder, opts);
		}

		this._routes = {};
	},

	stopped() {
		if (this.server && this.server.listening)
			uws.us_listen_socket_close(this.server.listenSocket);

		return Promise.resolve();
	},

	Errors: require("./errors"),
}