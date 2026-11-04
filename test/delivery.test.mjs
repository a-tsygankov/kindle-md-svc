import test from 'node:test';
import assert from 'node:assert/strict';
import { smtpCapture } from './helpers/smtp.mjs';
import { submitEmail } from '../dist/src/delivery.js';


test('SMTP submits a buffered attachment to the fixed recipient and reports submission only', async t => {
  const capture = await smtpCapture(); t.after(capture.close);
  const smtp = { enabled: true, host: '127.0.0.1', port: capture.port, security: 'none', from: 'reader@example.test', to: 'scribe@kindle.com', user: '', passwordEnv: 'KINDLE_TEST_UNUSED', maxAttachmentBytes: 1024 * 1024 };
  const result = await submitEmail(smtp, 'notes.pdf', Buffer.from('%PDF-fixture'), 'pdf');
  assert.equal(result.state, 'submitted');
  assert.equal(capture.messages.length, 1);
  assert.match(capture.recipients[0], /scribe@kindle.com/);
  assert.match(capture.messages[0], /Content-Type: application\/pdf/i);
  assert.match(capture.messages[0], /JVBERi1maXh0dXJl/);
  await assert.rejects(submitEmail({ ...smtp, enabled: false }, 'notes.pdf', Buffer.from('x'), 'pdf'), /disabled/i);
  await assert.rejects(submitEmail({ ...smtp, maxAttachmentBytes: 2 }, 'notes.pdf', Buffer.from('larger'), 'pdf'), /large|limit/i);
  assert.equal(capture.messages.length, 1);
});
