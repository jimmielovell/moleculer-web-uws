'use strict';

let { ServiceBroker } = require("moleculer");

let broker = new ServiceBroker({ logger: console });
const ApiGateway = require('./src/index');

broker.createService({
  name: 'math',
  actions: {
    add: {
      rest: 'GET /hello/:a/:b',
      params: {
        a: 'number',
      },
      handler(ctx) {
        return ctx.params.a + 2;
      }
    }
  },
  methods: {

  }
})

// Create a service
broker.createService({
  name: "test",
  mixins: [ApiGateway],

  settings: {
    assets: {
      etag: true,
      cache: {
        '**': 'no-cache'
      }
    },
    port: 9000,
  },
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
