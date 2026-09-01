export const ASSET_PATH = "assets/";

// Add a reaction by placing its video in assets and adding its filename here.
export const CONFIG = {
  assets: {
    start: "start.png", idle: "zalu32.png", button: "button.png",
    newspaper: "newspaper3.mp4", interrupt: "nedovolen.mp4",
    micIntro: "dh.mp4", micListening: "dh.png", micPlayback: "cp.mp4",
    phoneStart: "zvon.mp4", phoneIdle: "zvonok.png",
  },
  // Weighted random reactions: the first, second and last are intentionally more common.
  reactions: ["laughtda.mp4", "laughtda.mp4", "no.mp4", "no.mp4", "smeh.mp4", "udivl.mp4", "yes.mp4", "yes.mp4"],
  // Optional external tracks. Video files now keep their own sound enabled.
  audioMap: {
    // "dh.mp4": "dh.mp3",
    // "cp.mp4": "cp.mp3",
    // "yes.mp4": "yes.mp3",
  },
  vad: { threshold: 0.028, speechEndMs: 2000, minSpeechMs: 160, maxRecordingMs: 6000 },
  // A gentle, slightly faster chipmunk. Exact cp.mp4 duration is applied below.
  chipmunkPlaybackRate: 1.24,
  chipmunkDetuneCents: 0,
};

export const assetUrl = (name) => `${ASSET_PATH}${name}`;

