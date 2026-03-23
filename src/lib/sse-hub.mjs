export function createSseHub() {
  const clients = new Set();

  function writeEvent(res, event, payload) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  return {
    broadcast(event, payload) {
      for (const res of clients) {
        writeEvent(res, event, payload);
      }
    },
    close(res) {
      clients.delete(res);
    },
    open(res, initialEvents = [], headers = {}) {
      res.writeHead(200, {
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream",
        ...headers
      });

      for (const entry of initialEvents) {
        if (!entry?.event) {
          continue;
        }
        writeEvent(res, entry.event, entry.payload);
      }
      clients.add(res);
    }
  };
}
