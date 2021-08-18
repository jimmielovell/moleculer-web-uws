function handleDisconnect(connectionContext, options = {}) {
  const { exitCode = 1000, reason } = options;
  const { cancelKeepAlive, socket, isDisconnecting } = connectionContext;

  if (isDisconnecting) return

  connectionContext.isDisconnecting = true;
  // check if isClosing & if isClosing bail
  cancelKeepAlive && clearInterval(cancelKeepAlive);

  if (socket.done) return

  socket.end(exitCode, reason);
}

module.exports = handleDisconnect;