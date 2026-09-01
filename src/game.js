const BUILD = "20260901-12";
import { CONFIG, assetUrl } from "./config.js?v=20260901-12";
import { StateManager, States } from "./stateManager.js?v=20260901-12";
import { AudioManager } from "./audioManager.js?v=20260901-12";
import { UI } from "./ui.js?v=20260901-12";

async function initYandexGames() {
  try { if (window.YaGames?.init) await window.YaGames.init(); }
  catch (error) { console.info("Yandex Games SDK not present; standalone mode enabled.", error); }
}

console.info(`Talking Ben build ${BUILD}: newspaper3 + synced microphone mode`);

class Game {
  constructor() {
    this.ui = new UI();
    this.states = new StateManager();
    this.audio = new AudioManager(CONFIG.audioMap, CONFIG.chipmunkPlaybackRate);
    this.video = null;
    this.sceneCleanup = [];
    this.buttonCanvas = document.createElement("canvas");
    this.phoneEnabled = false;
    this.busy = false;
    this.permissionPending = false;
    this.pendingRecordingStop = null;
    this.videoDurations = new Map();
  }

  async init() {
    this.blockGestures();
    this.bindControls();
    this.ui.setControls(false);
    this.ui.setCharacterButton(false);
    await this.preload();
    this.ui.hideLoader();
    this.showImage(CONFIG.assets.start);
    this.states.transition(States.START_SCREEN);
    initYandexGames();
  }

  blockGestures() {
    document.addEventListener("contextmenu", (event) => event.preventDefault());
    document.addEventListener("gesturestart", (event) => event.preventDefault());
  }

  bindControls() {
    this.ui.stage.addEventListener("pointerdown", (event) => {
      if (this.states.state !== States.START_SCREEN) return;
      event.preventDefault();
      this.startSequence();
    });
    this.ui.characterButton.addEventListener("pointerdown", (event) => this.onCharacterPointer(event));
    document.querySelector("#mic-button").addEventListener("pointerdown", (event) => { event.preventDefault(); this.toggleMic(); });
    document.querySelector("#phone-button").addEventListener("pointerdown", (event) => { event.preventDefault(); this.togglePhone(); });
  }

  async preload() {
    const names = [...new Set([...Object.values(CONFIG.assets), ...CONFIG.reactions])];
    let done = 0;
    const update = () => this.ui.showProgress(++done / names.length * 100);
    await Promise.all(names.map((name) => new Promise((resolve) => {
      const isVideo = name.endsWith(".mp4");
      const item = isVideo ? document.createElement("video") : new Image();
      item.addEventListener(isVideo ? "loadedmetadata" : "load", () => { update(); resolve(); }, { once: true });
      item.addEventListener("error", () => { console.warn("Asset unavailable:", name); update(); resolve(); }, { once: true });
      item.preload = "metadata";
      item.src = assetUrl(name);
      if (isVideo) item.addEventListener("loadedmetadata", () => this.videoDurations.set(name, item.duration), { once: true });
    })));
    const button = new Image();
    button.src = assetUrl(CONFIG.assets.button);
    await button.decode().catch(() => {});
    this.buttonCanvas.width = button.naturalWidth;
    this.buttonCanvas.height = button.naturalHeight;
    this.buttonCanvas.getContext("2d", { willReadFrequently: true }).drawImage(button, 0, 0);
  }

  clearCurrent({ releaseMic = false, keepScene = false } = {}) {
    this.pendingRecordingStop?.({ cancelled: true });
    this.pendingRecordingStop = null;
    this.sceneCleanup.splice(0).forEach((cleanup) => cleanup());
    if (this.video) {
      this.video.pause();
      if (!keepScene) {
        this.video.removeAttribute("src");
        this.video.load();
      }
      this.video = null;
    }
    this.audio.stopAll({ releaseMic });
    if (!keepScene) this.ui.clearScene();
  }

  showImage(name) {
    this.video = null;
    return this.ui.image(assetUrl(name));
  }

  playVideo(name, { stopAfterMs = 0 } = {}) {
    return new Promise((resolve) => {
      const video = this.ui.video(assetUrl(name));
      this.video = video;
      let settled = false;
      let stopTimer = 0;
      const done = (ok = true) => {
        if (settled) return;
        settled = true;
        if (stopTimer) clearTimeout(stopTimer);
        video.removeEventListener("ended", done);
        video.removeEventListener("error", done);
        if (this.video === video) this.video = null;
        resolve(ok);
      };
      video.addEventListener("ended", done);
      video.addEventListener("error", done);
      this.sceneCleanup.push(done);
      video.play().catch((error) => {
        // Some embedded browsers reject unmuted playback even on a synthetic click.
        // Start silently as a fallback, then restore sound immediately.
        console.warn(`Unmuted playback was blocked for ${name}; retrying with activation fallback.`, error);
        video.muted = true;
        video.play().then(() => { video.muted = false; }).catch((retryError) => {
          console.warn(`Video playback failed: ${name}`, retryError);
          done(false);
        });
      });
      this.audio.playMapped(name);
      if (stopAfterMs > 0) {
        stopTimer = setTimeout(() => {
          // `done()` only resolves the state-machine promise; explicitly stop
          // the media element as well so cp.mp4 cannot continue in the scene.
          video.pause();
          video.removeAttribute("src");
          video.load();
          done();
        }, stopAfterMs);
      }
    });
  }

  async startSequence() {
    if (this.busy) return;
    this.busy = true;
    const token = this.states.transition(States.NEWSPAPER_1);
    const played = await this.playVideo(CONFIG.assets.newspaper);
    if (!played) { this.busy = false; this.ui.showNotice("Нажмите по экрану ещё раз, чтобы разрешить воспроизведение видео со звуком."); return; }
    if (!this.states.isCurrent(token)) return;
    this.enterIdle();
  }

  enterIdle() {
    this.phoneEnabled = false;
    this.clearCurrent();
    this.showImage(CONFIG.assets.idle);
    this.states.transition(States.IDLE);
    this.ui.setCharacterButton(true);
    this.ui.setControls(true);
    this.ui.setMicrophone("Микрофон выключен");
    this.busy = false;
  }

  isOpaqueButtonPoint(event) {
    const rect = this.ui.characterButton.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) * this.buttonCanvas.width / rect.width);
    const y = Math.floor((event.clientY - rect.top) * this.buttonCanvas.height / rect.height);
    if (x < 0 || y < 0 || x >= this.buttonCanvas.width || y >= this.buttonCanvas.height) return false;
    return this.buttonCanvas.getContext("2d", { willReadFrequently: true }).getImageData(x, y, 1, 1).data[3] > 12;
  }

  onCharacterPointer(event) {
    if (!this.isOpaqueButtonPoint(event)) return;
    event.preventDefault();
    this.interrupt();
  }

  async interrupt() {
    // Intentionally restart this video even if it is already playing: this zone has absolute priority.
    this.busy = true;
    this.phoneEnabled = false;
    this.ui.setCharacterButton(true);
    this.ui.setControls(true);
    this.clearCurrent({ releaseMic: true, keepScene: true });
    const token = this.states.transition(States.INTERRUPT);
    await this.playVideo(CONFIG.assets.interrupt);
    if (this.states.isCurrent(token)) this.enterIdle();
  }

  async needMicrophone() {
    try {
      this.ui.setMicrophone("Запрашиваем доступ к микрофону…");
      await this.audio.getStream();
      this.ui.setMicrophone("Микрофон включён", true);
      return true;
    } catch (error) {
      console.warn(error);
      this.ui.setMicrophone("Нет доступа к микрофону", false, true);
      this.ui.showNotice("Разрешите доступ к микрофону в настройках браузера.");
      return false;
    }
  }

  stopModeForSwitch() {
    if (this.states.state === States.IDLE) return;
    this.phoneEnabled = false;
    this.clearCurrent({ keepScene: true });
    this.showImage(CONFIG.assets.idle);
    this.states.transition(States.IDLE);
  }

  async toggleMic() {
    if ([States.MIC_MODE, States.MIC_RECORDING, States.MIC_PLAYBACK].includes(this.states.state)) {
      this.enterIdle();
      return;
    }
    if (this.permissionPending) return;
    this.stopModeForSwitch();
    this.permissionPending = true;
    this.busy = true;
    this.ui.showNotice();
    const allowed = await this.needMicrophone();
    this.permissionPending = false;
    if (!allowed) { this.busy = false; return; }

    this.clearCurrent({ keepScene: true });
    const token = this.states.transition(States.MIC_MODE);
    this.micLoop(token);
  }

  async micLoop(token) {
    let firstCycle = true;
    while (this.states.isCurrent(token)) {
      this.states.transition(States.MIC_RECORDING);
      token = this.states.token();
      let recorded = null;
      try {
        // The intro video is played only once. Every following cycle starts
        // directly from the listening image, as in the original flow.
        if (firstCycle) {
          await this.playVideo(CONFIG.assets.micIntro);
          firstCycle = false;
        }
        if (!this.states.isCurrent(token)) return;
        this.showImage(CONFIG.assets.micListening);
        if (!this.states.isCurrent(token)) return;
        await this.audio.startRecording();
        recorded = await this.recordUntilSpeechEnd(token);
      } catch (error) {
        console.warn("Recording failed", error);
        this.ui.showNotice("Не удалось начать запись. Проверьте доступ к микрофону.");
        this.enterIdle();
        return;
      }
      if (!this.states.isCurrent(token) || recorded?.cancelled) return;
      if (!recorded?.blob || !recorded.hadSpeech) {
        this.ui.showNotice("Речь не обнаружена. Попробуйте ещё раз.");
        this.enterIdle();
        return;
      }
      if (!this.states.isCurrent(token)) return;

      this.states.transition(States.MIC_PLAYBACK);
      token = this.states.token();
      let clip;
      try {
        clip = await this.audio.createChipmunkClip(recorded.blob);
      }
      catch (error) { console.warn("Voice processing failed", error); }
      if (!this.states.isCurrent(token)) return;
      // The processed voice defines the exact reaction length. Start cp.mp4
      // and stop it as soon as the Web Audio source ends.
      const playbackVideo = this.playVideo(CONFIG.assets.micPlayback);
      const voiceSource = clip?.play();
      if (voiceSource) voiceSource.addEventListener("ended", () => {
        const cpVideo = this.video;
        if (cpVideo && cpVideo.currentSrc.endsWith(CONFIG.assets.micPlayback)) {
          cpVideo.pause();
          // Resolve playVideo() immediately when the voice ends, then release
          // the element. The next loop renders dh.png without a black frame.
          cpVideo.dispatchEvent(new Event("ended"));
          cpVideo.removeAttribute("src");
          cpVideo.load();
        }
      }, { once: true });
      await playbackVideo;
      if (!this.states.isCurrent(token)) return;

      this.states.transition(States.MIC_MODE);
      token = this.states.token();
    }
  }

  async recordUntilSpeechEnd() {
    let finish;
    let hadSpeech = false;
    const ended = new Promise((resolve) => { finish = resolve; });
    const stopVad = await this.audio.listenForSpeech(CONFIG.vad, finish, () => { hadSpeech = true; });
    const maxTimer = setTimeout(() => finish({ hadSpeech, maxReached: true }), CONFIG.vad.maxRecordingMs);
    this.pendingRecordingStop = (reason = { cancelled: true }) => finish(reason);
    const result = await ended;
    clearTimeout(maxTimer);
    stopVad?.();
    this.pendingRecordingStop = null;
    return { blob: await this.audio.stopRecording(), hadSpeech: Boolean(result?.hadSpeech), cancelled: Boolean(result?.cancelled) };
  }

  async togglePhone() {
    if (this.phoneEnabled) { this.enterIdle(); return; }
    if (this.permissionPending) return;
    this.stopModeForSwitch();
    this.permissionPending = true;
    this.busy = true;
    this.ui.showNotice();
    const allowed = await this.needMicrophone();
    this.permissionPending = false;
    if (!allowed) { this.busy = false; return; }

    this.phoneEnabled = true;
    this.clearCurrent({ keepScene: true });
    const token = this.states.transition(States.PHONE_MODE);
    this.phoneLoop(token);
  }

  async phoneLoop(token) {
    await this.playVideo(CONFIG.assets.phoneStart);
    if (!this.states.isCurrent(token)) return;
    while (this.states.isCurrent(token) && this.phoneEnabled) {
      this.states.transition(States.PHONE_LISTENING);
      token = this.states.token();
      this.showImage(CONFIG.assets.phoneIdle);
      await new Promise((resolve) => this.audio.listenForSpeech(CONFIG.vad, resolve));
      if (!this.states.isCurrent(token)) return;
      this.clearCurrent();
      this.states.transition(States.PHONE_RESPONSE);
      token = this.states.token();
      const reaction = CONFIG.reactions[Math.floor(Math.random() * CONFIG.reactions.length)];
      await this.playVideo(reaction);
      if (!this.states.isCurrent(token)) return;
    }
  }
}

new Game().init();
