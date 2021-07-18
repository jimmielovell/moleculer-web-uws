# An API Gateway for Moleculer framework


The `moleculer-web-uws` is a fast API gateway service for [Moleculer](https://github.com/moleculerjs/moleculer) based on [µWebSockets.js](https://github.com/uNetworking/uWebSockets.js) server. Use it to publish your services over HTTP.

## Features
* HTTP & HTTPS
* Serve static files
* Multiple routes
* File uploading
* whitelist
* Multiple body parsers (json, urlencoded, text)
* CORS headers
* ETags
* Rate limiter
* Global before & after call hooks
* Buffer & Stream handling
* Support authorization

## Install
```
npm install moleculer-web-uws --save
```

## Usage

### Run with default settings
This example uses API Gateway service with default settings.
You can access to all services (internal services not included) via `http://localhost:3000/`

```js
let { ServiceBroker } = require("moleculer");
let ApiService = require("moleculer-web-uws");

let broker = new ServiceBroker({ logger: console });

// Create a service
broker.createService({
    name: "test",
    actions: {
        hello: {
            rest: 'GET /hello',
            handler(ctx) {
                return "Hello API Gateway!"
            }
        }
    }
});

// Start server
broker.start();
```

**Test URLs:**
- Call `test.hello` action: `http://localhost:3000/test/hello`

## Documentation
Coming soon

## License
moleculer-web-uws is available under the [MIT license](https://tldrlegal.com/license/mit-license).

## Contact
Copyright (c) 2021 Jimmie Lovell
