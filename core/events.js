// Live updates: every open screen of a company keeps one Server-Sent Events
// stream, so the phone dashboard refreshes the moment money moves.
export function createEventBus() {
  const clients = new Map(); // companyId -> Set(res)
  return {
    subscribe(companyId, res) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 5000\n\n');
      if (!clients.has(companyId)) clients.set(companyId, new Set());
      clients.get(companyId).add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      res.on('close', () => { clearInterval(ping); clients.get(companyId)?.delete(res); });
    },
    emit(companyId, type, data = {}) {
      const set = clients.get(companyId);
      if (!set) return;
      const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const res of set) res.write(msg);
    },
    count: (companyId) => clients.get(companyId)?.size || 0,
  };
}
