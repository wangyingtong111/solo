import { createServer } from 'http';
import app from './app.js';
import { initWebSocketServer } from './services/websocketServer.js';

const PORT = process.env.PORT || 3001;

const server = createServer(app);

initWebSocketServer(server);

server.listen(PORT, () => {
  console.log(`Server ready on port ${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}/ws`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;
