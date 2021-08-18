
'use strict';

let { ServiceBroker } = require('moleculer');

let broker = new ServiceBroker({ logger: console });
const ApiGateway = require('./src/index');

broker.createService({
  name: 'test',
  actions: {
    add: {
      ws: {
        publish: true,
        send: false,
        conditional: false // Should return a truthy result
      },
      // params: {
      //   a: 'number',
      // },
      handler(ctx) {
        return ctx.params;
      }
    },

    hello: {
      rest: 'GET /hello',
      handler(ctx) {
        return "Hello World!"
      }
    },

    namedParameter: {
      rest: 'GET /hello/:name',
      handler(ctx) {
        return 'Hello ' + ctx.params.name + '!';
      }
    },

    jsonBody: {
      rest: 'POST json /post/json',
      handler(ctx) {
        return 'Hello ' + ctx.params.name + '!';
      }
    }
  },
  methods: {

  }
})

// Create a service
broker.createService({
  name: "api",
  mixins: [ApiGateway],

  settings: {
    // Serve static files, this is called as a separate service
    assets: {
      etag: true,
      cache: {
        '**': 'no-cache'
      }
    },

    port: 3000,
  }
});

// Start server
broker.start();
