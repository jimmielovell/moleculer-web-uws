# An API Gateway for Moleculer framework

The `moleculer-web-uws` is a fast API gateway service for [Moleculer](https://github.com/moleculerjs/moleculer) based on [µWebSockets.js](https://github.com/uNetworking/uWebSockets.js) server. Use it to publish your services over HTTP and WebSockets.

## Features

* HTTP & HTTPS
* WebSockets with pub/sub support
* Serve static files
* Multiple routes
* File uploading
* Multiple body parsers (json, urlencoded, text)
* CORS headers
* Rate limiter
* Global before & after call hooks
* Buffer & Stream handling
* Support authentication
* Support authorization

## Install

```js
npm install moleculer-web-uws --save
```

## Usage

### Run with default settings

This example uses the API Gateway service with default settings.
You can access all services (internal services not included) via `http://localhost:3000/`

```js
let { ServiceBroker } = require('moleculer');
let ApiGateway = require('moleculer-web-uws');

let broker = new ServiceBroker({ logger: console });

// Create a service
broker.createService({
    name: 'test',

    actions: {
        hello: {
            rest: 'GET /hello',

            handler(ctx) {
                return 'Hello API Gateway!'
            }
        }
    }
});

// Load API Gateway
broker.createService(ApiGateway);

// Start server
broker.start();
```

**Test URLs:**

> Call `test.hello` action: `http://localhost:3000/test/hello`

## Documentation

### Routes

You define a HTTP route in the action definition of your service using the rest property.

```js
broker.createService({
    name: 'test',

    actions: {
        hello: {
            // Define your route
            rest: 'GET /hello',

            handler(ctx) {
                return 'Hello API Gateway!'
            }
        }
    }
});
```

You can also use the shorthand definition, in which the HTTP method is resolved to GET

```js
broker.createService({
    name: 'test',

    actions: {
        hello: {
            // Call this action with `GET /test/hello`
            rest: '/hello',

            handler(ctx) {
                ...
            }
        }
    }
});
```

The route's url is resolved to `/service-name/route-path`

The `service-name` is the value passed to rest parameter in the schema settings object definition of your service or
if no value is passed, the service-name is resolved to the specified name
of your service. This is to avoid any collisions with other service's routes.

```js
broker.createService({
    name: 'test',

    settings: {
        // this becomes the service-name if defined
        rest: 'alttest'
    }

    actions: {
        hello: {
            rest: '/hello',

            handler(ctx) {
                ...
            }
        }
    }
});
```

The `route-path` is the value passed to rest parameter in the schema settings object definition of your service or
if no value is passed, the service-name is resolved to the specified name
of your service. This is to avoid any collisions with other service's routes.

### Body-Parser

The Api Gateway implements json, urlencoded, text and multipart (File Uploading) by default.
Only one of these can be used per route. To use a body-parser, you must add it to the rest definition.

```js
broker.createService({
    name: 'test',

    actions: {
        hello: {
            rest: 'GET json /hello', // Valid body-parsers are; json, urlencoded, text, multipart

            params: {
                name: 'string' // This should be passed in json format
            }

            handler(ctx) {
                const { name } = ctx.params;
                ...
            }
        }
    }
});
```

> Please note, the parsed body is accessible through ctx.params as an object with named properties as defined by the client.

### Named Parameters

To use a named parameter, define it in the form `route-path/:parametername`. The parameter is accessed through `ctx.params` where the parametername is the property name.

```js
broker.createService({
    name: 'test',

    actions: {
        hello: {
            rest: 'GET /hello/:name',

            handler(ctx) {
                const { name } = ctx.params;
                ...
            }
        }
    }
});
```

You can also use multiple named parameters as follows.

```js
broker.createService({
    name: 'test',

    actions: {
        hello: {
            rest: 'GET /hello/:name/:age',

            handler(ctx) {
                const { name, age } = ctx.params;
                ...
            }
        }
    }
});
```

### File Uploading

To upload a file(s), use the `mulitpart` property and no other body-parser should should be defined on the same action.

```js
broker.createService({
    name: 'test',

    actions: {
        hello: {
            rest: {
                path: 'POST /upload',

                multipart: {
                    fileSize: 100000, // Size in bytes, that should not be exceeded

                    files: 1, // Number of files expected

                    fields: 3, // Number of fields that should not be exceeded.

                    onFileSizeLimit: (sizeOfReceivedFile, sizeExpected) => {
                        ...
                    },

                    onFieldsLimit: (numFieldsReceived, numFieldsExpected) => {
                        ...
                    },

                    onFilesLimit: (numFilesReceived, numFilesExpected) => {
                        ...
                    }
                }
            },

            handler(ctx) {
                // ctx.param will be an object of the form {fieldname, data, type, filename} or an array of
                // such objects if more than 1 file is received.
                const files = ctx.params;
                const { fieldname, data, type, filename, size } = file;

                // The fields are passed as an array of the form [fieldname => value]
                const fields = ctx.meta.$multipart;

                // Do something with the received file(s) and field(s)
                ...
            }
        }
    }
});
```

> Please note, the `data` property is a ReadableStream of the file data hence should be handled as a stream.

A global multipart options can be defined in the API Gateway as follows.

```js
broker.createService({
    name: 'apigateway',

    mixins: [APIGateway],

    settings: {
        multipart: {
            fileSize: 100000, // Size in bytes, that should not be exceeded

            files: 1, // Number of files expected

            fields: 3, // Number of fields that should not be exceeded.

            onFileSizeLimit: (size, sizeExpected) => {
                ...
            },

            onFieldsLimit: (numFields, numFieldsExpected) => {
                ...
            },

            onFilesLimit: (numFiles, numFilesExpected) => {
                ...
            }
        }
    }
});
```

You can use the shorthand definition where `multipart` is passed as the body-parser. The multipart settings defined in the API Gateway will be used instead.

```js
broker.createService({
    name: 'test',

    actions: {
        hello: {
            rest: 'POST multipart /upload',

            handler(ctx) {
                ...
            }
        }
    }
});
```

### Static Files

To access static files, define static settings in the API Gateway.

```js
broker.createService({
    name: 'apigateway',

    mixins: [APIGateway],

    settings: {
        static: {
            // The url through which the file will be accessible as `/assets/:filename.ext`
            rest: '/assets',

            // Path to the directory where the files are stored
            folder: '/assets',

            // Defaults to false
            cache: true,

            // Custom headers to pass to response headers
            // Optional
            headers: {},

            // Defaults to false
            etag: true,
        }
    }
});
```

The `Static File server` is published as a separate service.

### Whitelist

Service actions with the rest property in their definition are whitelisted by default.
If the rest property is not defined or the service action's visibility is not public, it'll not
be whitelisted to be accessed through the API Gateway.

> Please note, routes are not defined within the API Gateway, but within the action definition of your service's schema.

### WebSockets

To use WebSockets, `ws` setting must be defined in the API Gateway as follows.

```js
broker.createService({
  name: 'apigateway',

  mixins: [ApiGateway],

  settings: {
    ws: {
        path: '/*',

        compression: 0,

        idleTimeout: 0,

        maxBackPressure: 1024 * 1024,

        maxPayloadLength: 16 * 1024,

        keepAlive: {
            // Amount of seconds after which a PING message is sent to the client
            interval: 5000,

            // The message to be sent as a PING to the WebSocket client.
            // Can be any value, as long as the client will be able to identify it as a PING control message
            // from the server.
            ping: new Uint8Array([50]),

            // The message to be received from the WebSocket client as a PONG control message.
            // Can be a Uint8Array or integer(Will be converted to TypedArray)
            pong: new Uint8Array([50]),
        },

        upgrade: (res, req, context) => {
            ...
        },

        open: (socket) => {
            ...
        },

        message: async (app, socket, message, isBinary, topic) => {
            ...
        }
    },
  }
});
```

The `path` property MUST be passed. It is the url over which the WebSocket Connection is upgraded.
The rest of the properties are optional. If not defined, the are resolved to their default values.

#### compression

What permessage-deflate compression to use. Can be `DISABLED`, `SHARED_COMPRESSOR` or any of `DEDICATED_COMPRESSOR_xxxKB`. Defaults to `SHARED_COMPRESSOR`. Read more at [uWebSockets.js](https://unetworking.github.io/uWebSockets.js/generated/interfaces/WebSocketBehavior.html)

#### idleTimeout

Maximum amount of seconds that may pass without sending or getting a message. Connection is closed if this timeout passes. Disable by using 0. Defaults to 120. Read more at [uWebSockets.js](https://unetworking.github.io/uWebSockets.js/generated/interfaces/WebSocketBehavior.html)

#### maxBackPressure

Maximum length of allowed backpressure per socket when publishing or sending messages. Defaults to 1024 * 1024. Read more at [uWebSockets.js](https://unetworking.github.io/uWebSockets.js/generated/interfaces/WebSocketBehavior.html)

#### maxPayloadLength

Maximum length of received message. If a client tries to send a message larger than this, the connection is immediately closed. Defaults to 16 * 1024. Read more at [uWebSockets.js](https://unetworking.github.io/uWebSockets.js/generated/interfaces/WebSocketBehavior.html)

You can also whitelist an action to be accessed over WebSockets by including the `ws` property in its definition.
The action is routed through a PUB/SUB protocol in which the WebSocket client specifies the topic to publish the message to.
If this topic is matched, the received message from the client is passed to the action as `ctx.params`.

```js
broker.createService({
  name: 'test',

  actions: {
    draw: {
      ws: {
        // If not defined, the topic is resolved to `service-name/action-name`
        topic: 'tool/draw',

        // The result of this action will be published to all clients subscibed to this topic.
        // Optional
        publish: true,

        // The result of this action will be sent to the client who sent the message
        // Optional
        send: true,

        // If defined and is a callback, a client will only be subscribed to the topic if the callback returns true.
        // Optional
        condition: false // Should return a truthy result
      },

      handler(ctx) {
        const message = ctx.params;
        const connectionContext = ctx.meta.c_ctx;
        ...
        // Do something with the message and return the results(Optional)
      }
    }
  }
})
```

## License

moleculer-web-uws is available under the [MIT license](https://tldrlegal.com/license/mit-license).

## Contact

Copyright (c) 2021 Jimmie Lovell
