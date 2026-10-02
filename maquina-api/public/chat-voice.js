(function (root) {
  'use strict';
  function create(options) {
    var button = options.button, input = options.input, audio = options.audio;
    var Recognition = root.SpeechRecognition || root.webkitSpeechRecognition;
    var active = false, state = 'off', generation = 0, recognizer = null;
    var stream = null, recorder = null, context = null, interval = null, timer = null, request = null;
    var originalPlaceholder = input.placeholder, savedDraft = '', recognitionFailed = false;
    var utterance = null, captureVersion = 0;
    // Vozes femininas conhecidas do sistema (ex.: "Luciana", única voz pt-BR embutida no
    // Safari/iOS) -- evitamos usar a voz nativa do navegador quando só sobra uma dessas, pra
    // manter a voz do Drigo sempre a mesma. Sem opção boa, cai pro /voice/speak (Gemini, "Puck").
    var FEMALE_VOICE_NAMES = ['luciana', 'maria', 'camila', 'fernanda', 'helena', 'joana', 'vitória', 'vitoria', 'carla', 'raquel', 'marisa', 'isabela'];
    function isKnownFemaleVoice(v) { return FEMALE_VOICE_NAMES.indexOf((v.name || '').trim().toLowerCase()) !== -1; }
    function pickNonFemaleVoice() {
      if (!(root.speechSynthesis && root.SpeechSynthesisUtterance)) return null;
      var ptVoices = root.speechSynthesis.getVoices().filter(function (v) { return v.lang === 'pt-BR'; });
      return ptVoices.find(function (v) { return v.localService && !isKnownFemaleVoice(v); })
        || ptVoices.find(function (v) { return !isKnownFemaleVoice(v); })
        || null;
    }
    // Enquanto o Claude ainda esta processando (sobretudo numa rodada com uso de ferramenta,
    // que pode levar alguns segundos), silencio total parece travado. Depois de um tempo de
    // espera sem nenhuma fala real comecando, solta uma frase curta de espera na mesma voz que
    // vai responder -- nunca inventa conteudo da resposta, so preenche o silencio. E cancelada
    // assim que a fala real comeca (ou se a espera acabar em erro).
    var FILLER_DELAY_MS = 1100;
    var FILLER_PHRASES = ['Hum, deixa eu ver...', 'So um segundo...', 'Hum, vamos la...', 'Deixa eu pensar aqui...', 'Um segundinho...'];
    var fillerTimer = null;
    function cancelFiller() {
      if (fillerTimer) { clearTimeout(fillerTimer); fillerTimer = null; }
      if (root.speechSynthesis) root.speechSynthesis.cancel();
    }
    function armFiller() {
      cancelFiller();
      if (!active) return;
      var ticket = generation;
      fillerTimer = setTimeout(function () {
        fillerTimer = null;
        if (!active || ticket !== generation || streamActive) return;
        var voice = pickNonFemaleVoice();
        if (!voice) return; // sem voz nativa segura (ex.: Safari/iOS so com "Luciana") -- sem frase de espera por ora
        var phrase = FILLER_PHRASES[Math.floor(Math.random() * FILLER_PHRASES.length)];
        var u = new root.SpeechSynthesisUtterance(phrase);
        u.lang = 'pt-BR'; u.rate = 1.05; u.voice = voice;
        root.speechSynthesis.speak(u);
      }, FILLER_DELAY_MS);
    }
    // Fala progressiva (resposta em streaming): fala frase por frase conforme o texto vai
    // chegando, em vez de esperar a resposta inteira -- é o que deixa a voz começar bem mais
    // rápido. Só é usada quando tem uma voz nativa não-feminina disponível; senão, junta tudo e
    // usa o caminho de sempre (reply(), via Gemini) quando o streaming termina.
    var streamActive = false, streamBuffer = '', streamVoice = null, streamQueued = 0, streamFinished = 0, streamEnded = false;
    function speakStreamChunk(text, ticket) {
      streamQueued++;
      var u = new root.SpeechSynthesisUtterance(text);
      u.lang = 'pt-BR'; u.rate = 1.08; u.voice = streamVoice;
      u.onend = u.onerror = function () { streamFinished++; maybeFinishStream(ticket); };
      root.speechSynthesis.speak(u);
    }
    function extractCompleteSentences(buf) {
      var re = /[.!?]+(?:["')\]]*)(\s+|$)/g, m, lastEnd = -1;
      while ((m = re.exec(buf))) { lastEnd = re.lastIndex; }
      if (lastEnd === -1) return null;
      return [buf.slice(0, lastEnd), buf.slice(lastEnd)];
    }
    function maybeFinishStream(ticket) {
      if (!active || ticket !== generation) return;
      if (streamEnded && streamQueued === streamFinished) { display('waiting'); resume(); }
    }
    function beginReplyStream() {
      if (!active) return;
      cancelFiller();
      pause(); display('speaking');
      streamBuffer = ''; streamQueued = 0; streamFinished = 0; streamEnded = false; streamActive = true;
      if (root.speechSynthesis) root.speechSynthesis.cancel();
      streamVoice = pickNonFemaleVoice();
    }
    function replyChunkStream(delta) {
      if (!active || !streamActive || !delta) return;
      streamBuffer += delta;
      if (!streamVoice) return; // sem voz nativa boa: só acumula, fala tudo no final via Gemini
      var split = extractCompleteSentences(streamBuffer);
      if (split) { streamBuffer = split[1]; speakStreamChunk(split[0], generation); }
    }
    function resetReplyStream() {
      // Texto descartado (rodada de tool use que não era a resposta final): o que já tiver sido
      // falado não dá pra desfazer, mas isso é raro -- o modelo normalmente não escreve frase
      // inteira antes de decidir chamar uma ferramenta.
      streamBuffer = '';
    }
    function replyEndStream(fullText) {
      if (!active || !streamActive) return;
      streamActive = false; streamEnded = true;
      if (streamVoice) {
        if (streamBuffer.trim()) { var t = streamBuffer; streamBuffer = ''; speakStreamChunk(t, generation); }
        maybeFinishStream(generation);
        return;
      }
      reply(fullText);
    }
    function display(next) {
      state = next;
      button.classList.toggle('voice-active', active);
      button.classList.toggle('recording', active && next === 'listening');
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-label', active ? 'Encerrar conversa por voz' : 'Iniciar conversa por voz');
      input.placeholder = !active ? originalPlaceholder : next === 'listening' ? 'Ouvindo… fale à vontade' : next === 'speaking' ? 'Drigo está falando…' : 'Drigo está preparando a resposta…';
    }
    function clearCapture() {
      captureVersion++;
      clearTimeout(timer); timer = null;
      clearInterval(interval); interval = null;
      if (recognizer) { var r = recognizer; recognizer = null; r.abort(); }
      if (recorder && recorder.state !== 'inactive') { recorder.onstop = null; recorder.stop(); }
      recorder = null;
      if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
      stream = null;
      if (context) context.close().catch(function () {});
      context = null;
    }
    function pause() { clearCapture(); if (active) display('waiting'); }
    function stop() {
      if (!active) return;
      if (options.stopped) options.stopped();
      active = false; generation++;
      clearCapture();
      cancelFiller();
      if (request) request.abort(); request = null;
      if (root.speechSynthesis) root.speechSynthesis.cancel();
      if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); audio.removeAttribute('src'); }
      utterance = null;
      streamActive = false; streamBuffer = '';
      input.value = savedDraft;
      display('off');
    }
    function resume() {
      if (!active || options.busy() || state === 'speaking' || state === 'listening') return;
      clearTimeout(timer);
      timer = setTimeout(listen, 150);
    }
    function submit(text, ticket) {
      if (!active || ticket !== generation || !text.trim()) return;
      pause();
      input.value = savedDraft;
      options.submit(text.trim());
    }
    function fail(text, ticket) {
      if (!active || ticket !== generation) return;
      stop(); options.error(text);
    }
    function listen() {
      if (!active || options.busy()) return;
      clearCapture(); display('listening');
      var ticket = generation, captureTicket = captureVersion;
      if (Recognition && !recognitionFailed) {
        var r = new Recognition(); recognizer = r;
        r.lang = 'pt-BR'; r.continuous = true; r.interimResults = true;
        var finalText = '', interim = '';
        r.onresult = function (event) {
          if (!active || ticket !== generation || recognizer !== r) return;
          interim = '';
          for (var i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) finalText += event.results[i][0].transcript + ' ';
            else interim += event.results[i][0].transcript;
          }
          input.value = (finalText + interim).trim();
          clearTimeout(timer);
          // Display interim words immediately; submit after a short speaking pause.
          timer = setTimeout(function () { submit(finalText + interim, ticket); }, interim ? 1100 : 550);
        };
        r.onend = function () {
          if (!active || ticket !== generation || recognizer !== r) return;
          recognizer = null;
          if ((finalText + interim).trim()) submit(finalText + interim, ticket);
          else { display('waiting'); resume(); }
        };
        r.onerror = function (event) {
          if (ticket !== generation || recognizer !== r) return;
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'audio-capture') {
            fail('Não consegui acessar o microfone. Confira a permissão do navegador e toque no botão para tentar novamente.', ticket);
          } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
            recognitionFailed = true; clearCapture(); listen();
          }
        };
        try { r.start(); } catch (_) { recognitionFailed = true; clearCapture(); listen(); }
        return;
      }
      // Compatibility path: record only this turn, then transcribe on the server.
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(function (media) {
        if (!active || ticket !== generation || captureTicket !== captureVersion || state !== 'listening') { media.getTracks().forEach(function (t) { t.stop(); }); return; }
        stream = media;
        var mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].filter(function (type) { return root.MediaRecorder.isTypeSupported(type); })[0];
        recorder = mime ? new root.MediaRecorder(media, { mimeType: mime }) : new root.MediaRecorder(media);
        var chunks = [], localRecorder = recorder, speech = false, silence = 0, started = Date.now();
        recorder.ondataavailable = function (event) { if (event.data.size) chunks.push(event.data); };
        recorder.onstop = function () {
          if (!active || ticket !== generation) return;
          var blob = new Blob(chunks, { type: localRecorder.mimeType });
          clearCapture(); display('waiting');
          if (!speech || !blob.size) { resume(); return; }
          request = new AbortController();
          fetch('/voice/transcribe', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob, signal: request.signal })
            .then(function (r) { if (!r.ok) throw Error('transcribe'); return r.json(); })
            .then(function (data) { if (!data.text) throw Error('empty'); submit(data.text, ticket); })
            .catch(function () { fail('Não consegui entender o áudio. Toque no botão para tentar novamente ou escreva sua mensagem.', ticket); });
        };
        context = new (root.AudioContext || root.webkitAudioContext)();
        var analyser = context.createAnalyser(); analyser.fftSize = 512;
        context.createMediaStreamSource(media).connect(analyser);
        var samples = new Uint8Array(analyser.fftSize);
        recorder.start();
        interval = setInterval(function () {
          analyser.getByteTimeDomainData(samples);
          var peak = 0; for (var i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i] - 128));
          if (peak > 10) { speech = true; silence = 0; } else silence += 100;
          if ((speech && silence >= 700) || Date.now() - started > 45000) {
            clearInterval(interval); interval = null;
            if (localRecorder.state !== 'inactive') localRecorder.stop();
          }
        }, 100);
      }).catch(function () { fail('Não consegui acessar o microfone. Confira a permissão do navegador.', ticket); });
    }
    function reply(text) {
      if (!active || !text) return;
      cancelFiller();
      pause(); display('speaking');
      var ticket = generation;
      function done() { if (active && ticket === generation) { display('waiting'); resume(); } }
      // Native TTS starts without waiting for another AI audio-generation request -- mas só
      // usamos quando dá pra evitar cair numa voz feminina conhecida do sistema (ver
      // pickNonFemaleVoice acima); sem opção boa, cai pro /voice/speak (Gemini, voz "Puck").
      var nativeVoice = pickNonFemaleVoice();
      if (nativeVoice) {
        root.speechSynthesis.cancel();
        utterance = new root.SpeechSynthesisUtterance(text);
        utterance.lang = 'pt-BR'; utterance.rate = 1.08;
        utterance.voice = nativeVoice;
        utterance.onend = done; utterance.onerror = done;
        root.speechSynthesis.speak(utterance);
        return;
      }
      request = new AbortController();
      fetch('/voice/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text }), signal: request.signal })
        .then(function (r) { if (!r.ok) throw Error('speak'); return r.json(); })
        .then(function (data) {
          if (!active || ticket !== generation) return;
          if (!data.audio) throw Error('empty');
          audio.onended = done; audio.onerror = done;
          audio.src = 'data:' + (data.mimeType || 'audio/wav') + ';base64,' + data.audio;
          audio.play().catch(done);
        }).catch(done);
    }
    if (!button) return { stop: function () {}, pause: function () {}, resume: function () {}, reply: function () {}, beginReply: function () {}, replyChunk: function () {}, resetReply: function () {}, replyEnd: function () {}, armWait: function () {}, cancelWait: function () {} };
    if (!Recognition && !(navigator.mediaDevices && root.MediaRecorder)) button.style.display = 'none';
    button.addEventListener('click', function () {
      if (active) { stop(); return; }
      savedDraft = input.value; active = true; generation++; display('waiting');
      if (!options.busy()) listen();
    });
    root.addEventListener('pagehide', stop);
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); });
    return { stop: stop, pause: pause, resume: resume, reply: reply, beginReply: beginReplyStream, replyChunk: replyChunkStream, resetReply: resetReplyStream, replyEnd: replyEndStream, armWait: armFiller, cancelWait: cancelFiller };
  }
  root.DrigoVoice = { create: create };
})(window);
