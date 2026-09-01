export const States = Object.freeze({
  START_SCREEN: "START_SCREEN", NEWSPAPER_1: "NEWSPAPER_1", NEWSPAPER_2: "NEWSPAPER_2", IDLE: "IDLE",
  MIC_MODE: "MIC_MODE", MIC_RECORDING: "MIC_RECORDING", MIC_PLAYBACK: "MIC_PLAYBACK",
  PHONE_MODE: "PHONE_MODE", PHONE_LISTENING: "PHONE_LISTENING", PHONE_RESPONSE: "PHONE_RESPONSE", INTERRUPT: "INTERRUPT",
});

export class StateManager {
  constructor(onChange = () => {}) { this.state = States.START_SCREEN; this.runId = 0; this.onChange = onChange; }
  transition(next) { this.state = next; this.runId += 1; console.info(`[Game state] ${next} (#${this.runId})`); this.onChange(next); return this.runId; }
  token() { return this.runId; }
  isCurrent(token) { return token === this.runId; }
}
