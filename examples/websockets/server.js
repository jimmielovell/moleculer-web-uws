
'use strict';

let { ServiceBroker } = require('moleculer');

let broker = new ServiceBroker({ logger: console });
const ApiGateway = require('./src/index');

/**
 * To define a websocket
 * Define a ws object at the settings object of the API Gateway
 */
broker.createService({
  name: 'test',
  actions: {
    draw: {
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
    }
  },
  methods: {

  }
})

// Create a service
broker.createService({
  name: 'apigateway',
  mixins: [ApiGateway],

  settings: {
    ws: {
      path: '/*',
      keepAlive: {
        interval: 5000,
        ping: new Uint8Array([57]),
        pong: new Uint16Array([65]),
      },

      open: (socket) => {
        socket.subscribe("drawing/canvas1");
      },
      upgrade: (res, req, context) => {

      },
      message: async (app, socket, message, isBinary, topic) => {
        // app.publish("drawing/canvas1", message, true);
      }
    },

    port: 3000,
  }
});

// Start server
broker.start();
