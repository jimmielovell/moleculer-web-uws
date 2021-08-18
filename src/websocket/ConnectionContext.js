const crypto = require('crypto');

class ConnectionContext {
  constructor(socket) {
    this.socket = socket;
    this.id = crypto.randomUUID();
    this.cancelKeepAlive = undefined;
    this.isAlive = true;
    this.isDisconnecting = true;
    this.subs = [];
    this.isReady = false;
  }

  ready() {
    this.isReady = true;
  }
}

module.exports = ConnectionContext;
