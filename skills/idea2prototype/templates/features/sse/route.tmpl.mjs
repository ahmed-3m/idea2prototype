// Idea2Prototype feature: sse — Server-Sent Events streaming route.
// Route-contract extension this relies on: a handler may write directly to
// ctx.res and return NOTHING — the server checks res.headersSent and leaves
// the stream open instead of trying to send a JSON response.
//
// The pattern to keep when you wire real events:
//   1. writeHead the SSE headers, 2. send an initial event, 3. setInterval
//   heartbeats, 4. clearInterval on close — the timer keeps the Node event
//   loop alive, so a stream that never clears it hangs the process.

// Demo stream so the effect is observable right after `add sse`.
// Replace the payload with your own events (or delete this route and its
// test once your real stream exists).
const events = {
  path: '/api/events',
  methods: {
    GET: async ({ req, res }) => {
      // Client may have aborted before dispatch — writing would emit an
      // unhandled stream error and the close event already fired.
      if (req.destroyed || res.destroyed) return;
      res.writeHead(200, {
        'content-type': 'text/event-stream', // SSE is UTF-8 by spec — no charset param
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const send = (event, data) => {
        if (res.writableEnded || res.destroyed) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      send('connected', { at: new Date().toISOString() });
      let beats = 0;
      const timer = setInterval(
        () => send('heartbeat', { beats: ++beats, at: new Date().toISOString() }),
        1000,
      );
      // res 'close' fires when the client disconnects OR when app.close()
      // calls closeAllConnections() — either way the heartbeat timer must die.
      // Listen on the RESPONSE only: req 'close' can fire when the request
      // message completes while the SSE response is still open, which would
      // silence heartbeats on a healthy connection.
      res.on('close', () => clearInterval(timer));
      // intentional no-return: the response IS the open stream
    },
  },
};

export default [events];
