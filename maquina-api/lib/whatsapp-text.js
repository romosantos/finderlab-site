'use strict';

// Twilio accepts at most 1,600 characters per message Body.
// https://www.twilio.com/docs/messaging/api/message-resource
function splitWhatsAppText(text) {
  const limit = 1500;
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    const paragraph = remaining.lastIndexOf('\n\n', limit - 2);
    const space = remaining.lastIndexOf(' ', limit - 1);
    let end = paragraph > 0 ? paragraph + 2 : space > 0 ? space + 1 : limit;
    // Do not split a UTF-16 surrogate pair at a hard boundary.
    if (end === limit && /[\uD800-\uDBFF]/.test(remaining[end - 1])) end -= 1;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

module.exports = { splitWhatsAppText };
