export class UI {
  constructor() { this.stage = document.querySelector("#stage"); this.loader = document.querySelector("#loader"); this.progress = document.querySelector("#load-progress"); this.notice = document.querySelector("#notice"); this.micStatus = document.querySelector("#microphone-status"); this.characterButton = document.querySelector("#character-button"); this.controls = document.querySelector(".controls"); }
  showProgress(value) { this.progress.textContent = `${Math.round(value)}%`; }
  hideLoader() { this.loader.classList.add("hidden"); }
  showNotice(message = "") { this.notice.textContent = message; this.notice.classList.toggle("visible", Boolean(message)); }
  setMicrophone(status, active = false, denied = false) { this.micStatus.textContent = status; this.micStatus.classList.toggle("on", active); this.micStatus.classList.toggle("denied", denied); }
  setCharacterButton(active) { this.characterButton.classList.toggle("active", active); }
  setControls(active) { this.controls.classList.toggle("active", active); }
  clearScene() { this.stage.replaceChildren(); }
  image(src) { const image = new Image(); image.src = src; image.alt = ""; image.draggable = false; this.stage.replaceChildren(image); requestAnimationFrame(() => image.classList.add("visible")); return image; }
  video(src) {
    const video = document.createElement("video");
    video.src = src;
    video.muted = false;
    video.defaultMuted = false;
    video.playsInline = true;
    video.setAttribute("webkit-playsinline", "");
    video.preload = "auto";
    // Keep the previous image visible while the first frame is decoded; this removes black flashes.
    const previous = [...this.stage.children];
    this.stage.appendChild(video);
    video.addEventListener("loadeddata", () => {
      previous.forEach((node) => node.remove());
      video.classList.add("visible");
    }, { once: true });
    return video;
  }
}
