const uws = require('uWebSockets.js');
const { MoleculerError, MoleculerServerError, MoleculerClientError, ServiceNotFoundError } = require('moleculer').Errors;
const { ServiceUnavailableError, NotFoundError, ForbiddenError, RateLimitExceeded, UnAuthorizedError, TopicNotFoundError } = Errors = require('./errors');
const { autoParser, bodyParser } = require('./bodyparser/bodyparser');
const multipart = require('./bodyparser/multipart');
const StaticServer = require('./staticserver');
const ConnectionContext = require('./websocket/ConnectionContext');
const pipeStream = require('./pipestream');
const keepAlive = require('./websocket/keepAlive');
const handleDisconnect = require('./websocket/handleDisconnect');
const { isObject, isFunction, isString, isNumber, normalizePath, isReadableStream, removeTrailingSlashes } = require('./utils');
const { StringDecoder } = require('string_decoder');

const decoder = new StringDecoder('utf8');

function getServiceFullname(svc) {
	if (svc.version != null && svc.settings.$noVersionPrefix !== true)
		return (typeof (svc.version) === 'number' ? 'v' + svc.version : svc.version) + '.' + svc.name;

	return svc.name;
}

/**
 * uWS API Gateway service for Moleculer microservices framework.
 *
 * Based on: https://github.com/moleculerjs/moleculer-web
 * @service
 */
 module.exports = {
	name: 'apigateway',

	settings: {
		static: false,

		ws: false,

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

		// If set to true, it will log the response data (default to disable)
		logResponseData: false,

		// If set to true, it will log 4xx client errors
		log4XXResponses: false,

		// Log the route registration related activity
		logRouteRegistration: 'info',
	},

	metadata: {
		$category: 'gateway',
		$description: 'uWs API Gateway service',
	},

	actions: {
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

				const endpoint = this.broker.findNextActionEndpoint(route.action);
				if (endpoint instanceof Error) {
					if (endpoint instanceof ServiceNotFoundError)
						throw new ServiceUnavailableError();

					throw endpoint;
				}
				req.$endpoint = endpoint;

				const requestID = req.headers['x-correlation-id'] || req.headers['x-request-id'];
				if (requestID)
					res.setHeader('X-Request-Id', ctx.requestID);

				return this.routeHandler(ctx, req, res);
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
					throw new MoleculerServerError(`Port ${this.settings.port} is already in use!`);

				this.server.listening = true;
				this.server.listenSocket = listenSocket;

				this.logger.info(`API Gateway Server listening on PORT ${this.settings.port}`);
			});
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

				let servicePath = service.settings.rest && service.settings.rest !== ''
					? service.settings.rest
					: '/' + serviceName;
				// Replace periods incase the service is versioned
				servicePath = servicePath.replace(/\./g, '/');

				const actions = service.actions;
				let action = {}, _action;
				for (let i = 0, keys = Object.keys(actions); i < keys.length; i++) {
					_action = actions[keys[i]];
					if (_action.visibility !== 'private') {
						action.name = _action.name;
						action.authenticate = _action.authenticate;
						action.authorize = _action.authorize;

						if (_action.rest) {
							action.rest = _action.rest;
							this.createRestRoute(action, servicePath);
						} else if (_action.ws) {
							action.ws = _action.ws;
							this.createWSocketRoute(action, servicePath);
						}
					}
				}

				processedServices.add(serviceName);
			}

			try {
				this.registerPreflightRoute();
				this.register404Route();

				if (this.settings.ws) {
					this.registerWSocketRoutes();

					if (this.settings.logRouteRegistration && this.settings.logRouteRegistration in this.logger) {
						const entries = this._ws_routes.entries();
						for (let [topic, route] of entries) {
							this.logger[this.settings.logRouteRegistration]('Pub/Sub:', topic, '=>', route.action);
						}
					}
				}

				this.listenServer();
			} catch (err) {
				throw err;
			}
    },

		createWSocketRoute(action) {
			const ws = action.ws;
			if (!isObject(ws))
				return this.logger.error('The provided ws definition in', action.name, 'is invalid.');

			let topic = ws.topic || action.name.replace(/\./g, '\/');
			topic = normalizePath(topic);
			if (this._ws_routes.has(topic))
				return this.logger.error('The provided ws topic in', action.name, 'has already been defined in', this._ws_routes.get(topic).action);

			const route = {
				action: action.name,
				send: ws.send,
				publish: ws.publish,
				condition: ws.condition
			};
			this._ws_routes.set(topic, route);
		},

		registerWSocketRoutes() {
			const wsBehaviour = {};
			let { path, compression, idleTimeout, maxBackpressure, maxPayloadLength } = isObject(this.settings.ws) ? this.settings.ws : {};
			compression = compression ? compression.toUpperCase() : 'SHARED_COMPRESSOR';

			if (uws[compression]) wsBehaviour.compression = uws[compression];
			if (maxBackpressure) wsBehaviour.maxBackpressure = maxBackpressure;
			if (maxPayloadLength) wsBehaviour.maxPayloadLength = maxPayloadLength;
			if (idleTimeout) wsBehaviour.idleTimeout = idleTimeout;

			wsBehaviour.upgrade = this.wSocketUpgrade;
			wsBehaviour.open = this.wSocketOpen;
			wsBehaviour.message = this.wSocketMessage;
			wsBehaviour.close = this.wSocketClose;

			if (this.server) {
				const completepath = this.createFullRoutePath(path || '/*');
				this.server = this.server.ws(completepath, wsBehaviour);

				if (this.settings.logRouteRegistration && this.settings.logRouteRegistration in this.logger)
					this.logger[this.settings.logRouteRegistration]('WebSocket:', completepath);
			}
		},

		async wSocketUpgrade(res, _req, context) {
			try {
				const protocol = _req.getHeader('sec-websocket-protocol');
				const key = _req.getHeader('sec-websocket-key');
				const extensions = _req.getHeader('sec-websocket-extensions');
				let userData = {};
				let clientIp = _req.getHeader('x-forwarded-for');
				clientIp = (clientIp) ? clientIp : Buffer.from(res.getRemoteAddressAsText()).toString()// returns ipv6 e.g. '0000:0000:0000:0000:0000:ffff:ac11:0001'

				const headers = {};
				_req.forEach((key, value) => headers[key] = value);
				const req = {
					headers,
					remoteAddress: clientIp,
				}

				res.onAborted(() => {
					res.done = true
				});

				if (this.settings.ws.authenticate) {
					if (!isFunction(this.authenticate))
						return this.logger.error('Define \'authenticate\' method in the API Gateway to enable authentication.');

					userData.user = await this.authenticate(req, res);
				}
				if (this.settings.ws.authorize) {
					if (!isFunction(this.authorize))
						return this.logger.error('Define \'authorize\' method in the API Gateway to enable authentication.');

					userData.authz = await this.authorize(req, res);
				}

				// ALL async calls must come after the message listener, or we'll skip out on messages (e.g. resub after server restart)

				if (isFunction(this.settings.ws.upgrade)) {
					// Always return user data to be bound to the socket context or empty object
					// Client's address is bound by default as clientAddress
					const result = await this.settings.ws.upgrade(res, req, context);
					Object.assign(userData, result);
				}

				if (res.done) return

				userData.remoteAddress = req.remoteAddress;
				res.upgrade(userData, key, protocol, extensions, context);
			} catch (err) {
				if (res.done) return
				res.writeStatus('401').end();
			}
		},

		async wSocketOpen(socket) {
			const connectionContext = (socket.connectionContext = new ConnectionContext(socket));
			let object;

			if (isFunction(this.settings.ws.open)) {
				// Always return user data to be bound to the socket context or empty object
				// Client's address is bound by default as clientAddress
				// Return false if there is an error
				try {
					object = await this.settings.ws.open(socket);
				} catch (err) {
					this.logger.error(err);
				}
			}

			const entries = this._ws_routes.entries();
			for (let [topic, route] of entries) {
				let truthy = route.condition;

				if (isFunction(route.condition))
					truthy = route.condition(socket);
				if (truthy !== false)
					socket.subscribe(topic);
			}

			if (object === false)
				return null
			else if (object === null)
				return null;
			else if (!isObject(object))
				object = {};

			connectionContext.ready();
			// Handle PING/PONG; Heartbeats
			if (
				this.settings.ws.keepAlive && this.settings.ws.keepAlive.ping) {
				return keepAlive(connectionContext, this.settings.ws.keepAlive);
			}
		},

		async wSocketMessage(socket, message, isBinary) {
			try {
				const { connectionContext } = socket;
				message = Buffer.from(message);

				if (this.settings.ws.keepAlive) {
					let pong = this.settings.ws.keepAlive.pong;

					if (!(pong instanceof Uint8Array))
						this.settings.ws.keepAlive.pong = pong = new Uint8Array([pong]);

					if (Buffer.compare(message, pong) === 0)
						return keepAlive(connectionContext, this.settings.ws.keepAlive)
				}

				let route, topic;
				try {
					const protocol = JSON.parse(decoder.write(message));

					if (isObject(protocol)) {
						topic = protocol.topic;

						if (topic) {
							message = protocol.data;

							if (this._ws_routes.has(topic))
								route = this._ws_routes.get(topic);
							else
								return socket.send(new TopicNotFoundError());
						}
					}
				} catch (err) {}

				if (isFunction(this.settings.ws.message)) {
					if (connectionContext.isReady)
						message = await this.settings.ws.message(this.server, socket, message, isBinary, topic) || message;
				}

				if (route) {
					const endpoint = this.broker.findNextActionEndpoint(route.action);
					if (endpoint instanceof Error) {
						if (endpoint instanceof ServiceNotFoundError)
							throw new ServiceUnavailableError();

						throw endpoint;
					}

					let result = await this.broker.call(endpoint, message, {
						c_ctx: connectionContext // The ConnectionContext is passed to the meta object
					});
					if (result === undefined || result === null) return;

					if (typeof(result) !== 'string' && !(result instanceof ArrayBuffer) && !ArrayBuffer.isView(result)) {
						result = this.encodeJsonResponse(result);
					}

					if (route.send)
						socket.send(result);
					else if (route.publish)
						this.server.publish(topic, result, true);
				}
			} catch (err) {
				const message = err.data && err.data[0] ? err.data[0].message : '';
				socket.send(this.encodeJsonResponse({code: err.code, type: err.type, message }));
			}
		},

		wSocketClose(socket, code) {
			if (!socket.connectionContext) return

			socket.done = true;
			try {
				handleDisconnect(socket.connectionContext, { exitCode: code });
			} catch (err) {
				this.logger.error(err);
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
				route.passReqRes = rest.passReqRes;
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
			} else
				return this.logger.error('The provided rest definition in', action.name, 'is invalid.');

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
					method = 'GET',
					path = methodBpPath[0];
					break;
				case 0:
					method = '*';
					break;
			}

			if (!path) {
				path = action.name.replace(/\./g, '\/');
			} else {
				// Check for named parameters
				if (path.indexOf(':') > -1) {
					const namedParams = path.split(':').splice(1);
					route.namedParams = namedParams.map((param) => removeTrailingSlashes(param))
				}

				path = servicePath + '/' + path;
				path = normalizePath(path);
			}

			// Handle paths such as /test/hello/*/* -> /test/hello/*
			route.path = path.replace(/(?:\/\*){2,}/g, '/*');

			if (method === '*')
				method = 'any';
			else {
				method = method.toLowerCase();
				if (method === 'delete')
					method = 'del';
			}

			if (!['get', 'post', 'del', 'put', 'options', 'head'].includes(method))
				return this.logger.error('Unsurpported HTTP Method \'', method, '\'!');

			route.method = method;
			route.action = action.name;

			// Resolve the body parser at build time
			if (rest.multipart || bodyParserType === 'multipart') {
				const opts = Object.assign({}, this.settings.multipart, rest.multipart);
				route.multipart = opts;
				route.bodyParser = multipart;
			} else if (bodyParserType)
				route.bodyParser = bodyParser[bodyParserType];
			else
				route.bodyParser = autoParser;

			this.registerRestRoute(route);
		},

		registerRestRoute(route) {
			if (this.server) {
				let resolvedRoute;

				try {
					resolvedRoute = this.addRestRoute(route);
				} catch (err) {
					return this.logger.error('RouteError!', err.name, ':', err.message);
				}

				const completepath = this.createFullRoutePath(resolvedRoute.path);
				// Top Level Path
				const TLP_LENGTH = this.settings.path
					? this.settings.path.length - 1
					: 0

				this.server = this.server[route.method](completepath, async (res, _req) => {
					const $startTime = process.hrtime();
					const headers = {};
					const params = {};
					_req.forEach((key, value) => headers[key] = value);
					if (route.namedParams) {
						for (let i = 0; i < route.namedParams.length; i++) {
							const qp = _req.getParameter(i);
							if (qp) params[route.namedParams[i]] = qp;
						}
					}
					const req = {
						$startTime,
						$route: route,
						headers,
						method: _req.getMethod().toUpperCase(),
						query: _req.getQuery(),
						params,
						url: _req.getUrl().substring(TLP_LENGTH),
						remoteAddress: Buffer.from(res.getRemoteAddressAsText()).toString(),
					}
					this.logRequest(req);
					res = this.patchHttpRes(res, req);

					try {
						await this.actions.rest({ req, res });
						// if (!res.done) throw new Error();
					} catch (err) {
						// Clientside error logging
						if (this.settings.log4XXResponses && 400 < err.code && err.code < 500)
							this.logger.error('Request error!', err.name, ':', err.message, '\n', err.stack, '\nData:', err.data);
						return this.sendError(req, res, err);
					}
				});

				if (this.settings.logRouteRegistration && this.settings.logRouteRegistration in this.logger)
					this.logger[this.settings.logRouteRegistration]('HTTP:', route.method.toUpperCase(), completepath, '=>', route.action);
			}
		},

		addRestRoute(route) {
			let {path, method} = route;

			if (this._routes[method]) {
				if (this._routes[method][path])
					return this.logger.error('RouteRegistrationError:', method.toUpperCase(),' ', path, ' already exists');
				else
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

		registerPreflightRoute() {
			const completepath = this.createFullRoutePath('/*');
			this.server = this.server.options(completepath, (res, _req) => {
				const $startTime = process.hrtime();
				const req = {
					$startTime,
					url: _req.getUrl(),
					method: _req.getMethod().toUpperCase(),
					headers: {
						origin: _req.getHeader('origin'),
						'access-control-request-method': _req.getHeader('access-control-request-method')
					}
				}
				this.logRequest(req);

				res = this.patchHttpRes(res, req);

				try {
					if (this.settings.cors)
						this.writeCorsHeaders(req, res, true);

					if (req.headers['access-control-request-method']) {
						res.statusCode = 204;// No content
						res.setHeader('Content-Length', 0).end();
					}
				} catch (err) {
					res.statusCode = 500;
					res.end('Internal Server Error!');
				}
			});
		},

		register404Route() {
			this.server = this.server.any('/*', (res, _req) => {
				const $startTime = process.hrtime();
				const req = { $startTime, url: _req.getUrl(), method: _req.getMethod().toUpperCase() }
				this.logRequest(req);

				res = this.patchHttpRes(res, req);

				try {
					this.sendError(req, res, new NotFoundError());
					if (!res.done) throw new Error();
				} catch (err) {
					res.statusCode = 500;
					res.end('Internal Server Error!');
				}
			})
		},

		patchHttpRes(res, req) {
			res.onAborted(() => res.done = true)
			res.statusCode = 200;
			res._headers = new Map();
			res.setHeader = (key, value) => {
				res._headers.set(key+'', value+'');
				return res;
			}
			res.getHeader = (key) => {
				return res._headers.get(key);
			}
			res.removeHeader = (key) => {
				res._headers.delete(key);
				return res;
			}
			res._end = res.end;
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

		async routeHandler(ctx, req, res) {
			const route = req.$route;
			route.callOptions = route.callOptions ? { ...route.callOptions } : {};

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

			if (route.authenticate) {
				try {
					route.callOptions.user = await this.authenticate(req, res);
				} catch (err) {
					throw new UnAuthorizedError();
				}
			}
			if (route.authorize) {
				try {
					route.callOptions.authz = await this.authorize(req, res);
				} catch (err) {
					throw new UnAuthorizedError();
				}
			}

			if (route.multipart)
				return await this.multipartHandler(req, res);
			else
				req.body = await route.bodyParser(req, res);

			let params = req.params;
			const parsedQuery = this.parseQueryString(req.query);
			Object.assign(params, parsedQuery, req.body);

			return await this.callAction(ctx, req, res, params);
		},

		async callAction(ctx, req, res, params) {
			const route = req.$route;
			const actionName = route.action;

			// onBeforeCall handling
			if (this.settings.onBeforeCall)
				await this.settings.onBeforeCall.call(this, ctx, req, res);

			// Logging params
			if (this.settings.logging) {
				if (this.settings.logRequest && this.settings.logRequest in this.logger)
					this.logger[this.settings.logRequest](`Call '${actionName}' action`);
				if (this.settings.logRequestParams && this.settings.logRequestParams in this.logger)
					this.logger[this.settings.logRequestParams]('Params:', params);
			}

			const opts = route.callOptions;

			// Pass the `req` & `res` vars to ctx.meta.
			if (route.passReqRes) {
				if (opts.meta) {
					opts.meta.$req = req;
					opts.meta.$res = res;
				} else
					opts.meta = { $req: req, $res: res }
			}


			if (params && params.$params) {
				// Transfer URL parameters via meta in case of stream
				if (opts.meta) opts.meta.$params = params.$params;
				else opts.meta = { $params: params.$params };
			}

			let data = await ctx.call(req.$endpoint, params, opts);

			if (data instanceof Error)
				return this.sendError(req, res, data);

			// onAfterCall handling
			if (this.settings.onAfterCall)
				data = await this.settings.onAfterCall.call(this, ctx, req, res, data);

			this.sendResponse(ctx, req, res, data);

			return true;
		},

		writeCorsHeaders(req, res, isPreFlight) {
			const origin = req.headers['origin'];
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
					// AllowedHeaders not specified, send back from req headers
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
					res.setHeader('Access-Control-Max-Age', cors.maxAge);
			}
		},

		async multipartHandler(req, res) {
			const ctx = req.$ctx;
			const route = req.$route;
			const multipartOptions = route.multipart;
			const result = await route.bodyParser(req, res, multipartOptions);
			const { fields, files } = result;
			const numOfFiles = files.length;

			// Add limit event handlers
			if (result.fileSizeLimitExceeded && isFunction(multipartOptions.onFileSizeLimit)) {
				for (let i = 0; i < numOfFiles; i++) {
					multipartOptions.onFileSizeLimit.call(this.service, files[i].size, multipartOptions.fileSize);
				}
			}

			if (result.filesLimitExceeded && isFunction(multipartOptions.onFilesLimit))
				multipartOptions.onFilesLimit.call(this.service, numOfFiles, multipartOptions.files);

			if (result.fieldsLimitExceeded && isFunction(multipartOptions.onFieldsLimit))
				multipartOptions.onFieldsLimit.call(this.service, fields.length, multipartOptions.fields);

			if (multipartOptions.empty === false && numOfFiles === 0)
				throw new MoleculerClientError('File missing in the request!');

			ctx.meta.$multipart = fields;

			let data = await ctx.call(req.$endpoint, files.length > 1 ? files : files[0], {
				meta: { $multipart: fields }
			});

			if (route.onAfterCall)
				data = await route.onAfterCall.call(this, ctx, this.route, req, res, data);

			this.sendResponse(req, res, data, {});
		},

		encodeJsonResponse(data) {
			return JSON.stringify(data);
		},

		sendResponse(ctx, req, res, data) {
			// Custom status code from ctx.meta
			if (ctx.meta.$statusCode)
				res.statusCode = ctx.meta.$statusCode;

			if (ctx.meta.$responseHeaders) {
				for (let i = 0, keys = Object.keys(ctx.meta.$responseHeaders); i < keys.length; i++) {
					res.setHeader(keys[i], ctx.meta.$responseHeaders[keys[i]]);
				}
			}

			// Redirect
			if (res.statusCode >= 300 && res.statusCode < 400 && res.statusCode !== 304) {
				const location = ctx.meta.$location;
				if (!location)
					this.logger.warn(`The 'ctx.meta.$location' is missing for status code '${res.statusCode}'!`);
				else
					res.setHeader('Location', location);
			}

			if (req.method === 'HEAD')
				res.cork(() => res.end());

			if (data === null)
				return res.cork(() => res.end())

			let chunk;
			if (Buffer.isBuffer(data)) {// Buffer
				!res.getHeader('Content-Type') && res.setHeader('Content-Type', 'application/octet-stream');
				res.setHeader('Content-Length', data.length);
				chunk = data;
			} else if (isReadableStream(data)) {// Stream
				!res.getHeader('Content-Type') && res.setHeader('Content-Type', 'application/octet-stream');
				chunk = data;
			} else if (isObject(data) || Array.isArray(data)) {
				!res.getHeader('Content-Type') && res.setHeader('Content-Type', 'application/json; charset=utf-8');
				chunk = this.encodeJsonResponse(data);
			} else {// Other (stringify or raw text)
				!res.getHeader('Content-Type') && res.setHeader('Content-Type', 'text/plain');
				if (isString(data)) chunk = data;
				else chunk = data.toString();
			}

			// // Auto generate & add ETag
			// if (this.settings.etag && chunk && !isReadableStream(chunk)) {
			// 	res.setHeader('ETag', generateETag.call(this, chunk, route.etag));
			// 	// Freshness
			// 	if (isFresh(req, res))
			// 		res.statusCode = 304;
			// }

			if (res.statusCode === 204 || res.statusCode === 304) {
				res.removeHeader('Content-Type');
				res.removeHeader('Content-Length');
				res.removeHeader('Transfer-Encoding');
				res.cork(() => res.end());
			} else {
				if (isReadableStream(data)) {
					if (typeof(ctx.meta.$byteLength) !== 'number') {
						res.statusCode = 500;
						return res.cork(() => res.end(chunk));
					}

					res.writeStatus((res.statusCode)+'');
					for (let [key, value] of res._headers) {
						res.writeHeader(key, value);
					}
					pipeStream(res, data, ctx.meta.$byteLength);
					this.logResponse(req, res.statusCode);
				} else
					res.cork(() => res.end(chunk));
			}
		},

		sendError(req, res, err) {
			if (isFunction(this.settings.onError))
				return this.settings.onError.call(this, req, res, err);

			if (!err || !(err instanceof Error)) {
				res.statusCode = 500;
				return res.end('Internal Server Error!');
			}

			if (!(err instanceof MoleculerError)) {
				const e = err;
				err = new MoleculerError(e.message, e.code || e.status, e.type, e.data);
				err.name = e.name;
			}

			const statusCode = isNumber(err.code) && (400 < err.code && err.code < 599) ? err.code : 500;
			res.statusCode = statusCode;
			const { name, message, code, type, data } = err;
			res.setHeader('Content-Type', 'application/json; charset=utf-8');
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

		logRouteRegistration(...args) {
			if (this.settings.logging && this.settings.logRouteRegistration && this.settings.logRouteRegistrationin in this.logger)
				this.logger[this.settings.logRouteRegistration](...args);
		},

		logRequest(req) {
			if (this.settings.logging && this.settings.logRequest && this.settings.logRequest in this.logger)
				this.logger[this.settings.logRequest](`=> ${req.method} ${req.url}`);
		},

		logResponse(req, statusCode, data) {
			if (this.settings.logging && this.settings.logResponse && this.settings.logResponse in this.logger) {
				const diff = process.hrtime(req.$startTime);
				const duration = (diff[0] + diff[1] / 1e9) * 1000;
				const time = `[+${Number(duration).toFixed(3)} ms]`;
				let messageLog = `<= ${statusCode} ${req.method} ${req.url} ${time}`;

				if (this.settings.logResponseData)
					messageLog += '  Data:', data;

				this.logger[this.settings.logResponse](messageLog);
			}
		},

		checkOrigin(origin, settings) {
			if (isString(settings)) {
				if (settings.indexOf(origin) !== -1)
					return true;

				if (settings.indexOf('*') !== -1) {
					// Based on: https://github.com/hapijs/hapi
					const wildcard = new RegExp(`^${settings.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/\\\*/g, '.*').replace(/\\\?/g, '.')}$`);
					return origin.match(wildcard);
				}
			}

			return false;
		},
	},

	events: {
		'$services.changed'() {
			// ToDO: Rebuild and Reregister all the routes automatically
		},

    '$broker.started'() {
      this.createRoutes();
    }
	},

	created() {
		// Create a new HTTP/HTTPS server instance
		this.createServer();
		// Create static server service
		if (this.settings.assets) {
			Object.assign(StaticServer.settings, this.settings.assets)
			this.broker.createService(StaticServer);
		}

		this._routes = {};
		this._ws_routes = new Map();
		this.logger.info('API Gateway Server created.');
	},

	stopped() {
		if (this.server && this.server.listening)
			uws.us_listen_socket_close(this.server.listenSocket);
	},

	Errors,
	StaticServer
}