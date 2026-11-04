import net from 'node:net';

export async function smtpCapture() {
  const messages = [], recipients = [], sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8'); socket.write('220 localhost test SMTP\r\n');
    let buffer = '', data = false, message = '';
    socket.on('data', chunk => {
      buffer += chunk;
      while (buffer.includes('\r\n')) {
        const index = buffer.indexOf('\r\n'); const line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        if (data) {
          if (line === '.') { data = false; messages.push(message); message = ''; socket.write('250 queued locally\r\n'); }
          else message += line + '\r\n';
        } else if (/^EHLO|^HELO/i.test(line)) socket.write('250 localhost\r\n');
        else if (/^MAIL FROM:/i.test(line)) socket.write('250 sender OK\r\n');
        else if (/^RCPT TO:/i.test(line)) { recipients.push(line); socket.write('250 recipient OK\r\n'); }
        else if (/^DATA/i.test(line)) { data = true; socket.write('354 finish with dot\r\n'); }
        else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { messages, recipients, port: server.address().port, close: async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}
