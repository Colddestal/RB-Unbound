import { createServer } from 'node:http';
import { Server } from 'socket.io';

// Transport spike only. No shared state, privacy filters, authorization, or persistence yet.
// Bind to loopback to avoid exposing this prototype to the public internet.
const httpServer = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('RB Unbound experimental relay'); });
const io = new Server(httpServer, { cors: { origin: false }, maxHttpBufferSize: 20_000 });
io.on('connection', socket => { socket.emit('status', { message: 'Experimental transport only; rooms not implemented.' }); });
httpServer.listen(3001, '127.0.0.1', () => console.log('Local relay on http://127.0.0.1:3001'));
