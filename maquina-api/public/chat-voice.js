(function (root) {
  'use strict';
  function create(options) {
    var button = options.button, input = options.input, audio = options.audio;
    var Recognition = root.SpeechRecognition || root.webkitSpeechRecognition;
    var active = false, state = 'off', generation = 0, recognizer = null;
    var stream = null, recorder = null, context = null, interval = null, timer = null, request = null;
    var originalPlaceholder = input.placeholder, savedDraft = '', recognitionFailed = false;
    var utterance = null, captureVersion = 0;
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
      if (request) request.abort(); request = null;
      if (root.speechSynthesis) root.speechSynthesis.cancel();
      if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); audio.removeAttribute('src'); }
      utterance = null;
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
      pause(); display('speaking');
      var ticket = generation;
      function done() { if (active && ticket === generation) { display('waiting'); resume(); } }
      // Native TTS starts without waiting for another AI audio-generation request --
      // mas só usamos quando dá pra evitar cair numa voz feminina conhecida do sistema
      // (ex.: "Luciana", única voz pt-BR embutida no Safari/iOS): senão a voz do Drigo
      // trocava de gênero sozinha dependendo do aparelho. Sem opção boa, cai pro
      // /voice/speak (Gemini, voz "Puck") que mantém a mesma voz sempre.
      var FEMALE_VOICE_NAMES = ['luciana', 'maria', 'camila', 'fernanda', 'helena', 'joana', 'vitória', 'vitoria', 'carla', 'raquel', 'marisa', 'isabela'];
      function isKnownFemaleVoice(v) { return FEMALE_VOICE_NAMES.indexOf((v.name || '').trim().toLowerCase()) !== -1; }
      var nativeVoice = null;
      if (root.speechSynthesis && root.SpeechSynthesisUtterance) {
        var ptVoices = root.speechSynthesis.getVoices().filter(function (v) { return v.lang === 'pt-BR'; });
        nativeVoice = ptVoices.find(function (v) { return v.localService && !isKnownFemaleVoice(v); })
          || ptVoices.find(function (v) { return !isKnownFemaleVoice(v); })
          || null;
      }
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
    if (!button) return { stop: function () {}, pause: function () {}, resume: function () {}, reply: function () {} };
    if (!Recognition && !(navigator.mediaDevices && root.MediaRecorder)) button.style.display = 'none';
    button.addEventListener('click', function () {
      if (active) { stop(); return; }
      savedDraft = input.value; active = true; generation++; display('waiting');
      if (!options.busy()) listen();
    });
    root.addEventListener('pagehide', stop);
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); });
    return { stop: stop, pause: pause, resume: resume, reply: reply };
  }
  root.DrigoVoice = { create: create };
})(window);
