const handleDisconnect = require('./handleDisconnect');

function keepAlive(connectionContext, options) {
  connectionContext.isAlive = true;
  connectionContext.cancelKeepAlive && clearInterval(connectionContext.cancelKeepAlive);

  connectionContext.cancelKeepAlive = setInterval(() => {
    if (connectionContext.isAlive === false) {
      handleDisconnect(connectionContext)
    } else {
      connectionContext.isAlive = false
    }

    const { socket } = connectionContext;

    if (!socket.done)
      socket.send(options.ping);
  }, options.interval);
}

module.exports = keepAlive;
