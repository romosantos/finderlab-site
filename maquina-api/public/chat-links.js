(function (root) {
  'use strict';

  // Message content is untrusted: create text nodes and validated anchors only.
  var pattern = /\[([^\]\n]+)\]\((https?:\/\/[^\s<>]+|mailto:[^\s<>]+|tel:[+\d().-]+)\)|(?:https?:\/\/|mailto:|tel:)[^\s<>"']+|(?:[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)|(?:\b(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}(?:\.[a-z]{2})?(?:[/?#][^\s<>"']*)?)/gi;

  function hrefFor(value) {
    var href = value;
    if (!/^(https?:|mailto:|tel:)/i.test(href)) {
      href = href.indexOf('@') !== -1 ? 'mailto:' + href : 'https://' + href;
    }
    try {
      var url = new URL(href);
      if (!/^(https?:|mailto:|tel:)$/.test(url.protocol)) return null;
      if (/^https?:$/.test(url.protocol) && !url.hostname) return null;
      return url.href;
    } catch (_) { return null; }
  }

  function tokens(text) {
    text = String(text == null ? '' : text);
    var result = [], last = 0, match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text))) {
      if (match.index > last) result.push({ text: text.slice(last, match.index) });
      var raw = match[0], label = match[1], value = match[2] || raw, tail = '';
      if (!label) {
        while (/[.,;:!?\])}]$/.test(value)) {
          var end = value.slice(-1);
          var opening = { ')': '(', ']': '[', '}': '{' }[end];
          if (opening && value.split(opening).length >= value.split(end).length) break;
          tail = end + tail;
          value = value.slice(0, -1);
        }
      }
      var href = hrefFor(value);
      result.push(href ? { text: label || value, href: href } : { text: raw });
      if (tail && href) result.push({ text: tail });
      last = pattern.lastIndex;
    }
    if (last < text.length) result.push({ text: text.slice(last) });
    return result;
  }

  function render(container, text) {
    container.textContent = '';
    container.dataset.message = text;
    tokens(text).forEach(function (part) {
      if (!part.href) {
        container.appendChild(document.createTextNode(part.text));
        return;
      }
      var a = document.createElement('a');
      a.href = part.href;
      a.textContent = part.text;
      if (/^https?:/.test(part.href)) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
      container.appendChild(a);
    });
  }

  function addTermsAcceptance(container, onAccept, label) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'chat-accept-terms';
    button.textContent = label === 'sim, concordo' ? label : 'sim, aceito';
    button.addEventListener('click', function () {
      if (button.disabled) return;
      // The caller returns false while another response is in progress.
      if (onAccept() !== false) {
        button.disabled = true;
        button.textContent = 'Aceite enviado';
      }
    });
    container.appendChild(button);
  }

  var api = { render: render, tokens: tokens, addTermsAcceptance: addTermsAcceptance };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DrigoChatLinks = api;
})(typeof window !== 'undefined' ? window : globalThis);
