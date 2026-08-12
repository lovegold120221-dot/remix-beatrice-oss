/**
 * Audio processing utilities for Beatrice OSS Eburon Live API integration.
 * Converts microphone audio to 16kHz Int16 Little-Endian PCM base64 strings.
 * Plays incoming 24kHz Int16 PCM base64 audio chunks in real time.
 * Includes Voice Activity Detection (VAD) with RMS calculation, barge-in support, and silence timeout.
 */

export interface VadConfig {
  enabled: boolean;
  threshold: number; // RMS energy threshold (e.g. 0.015)
  silenceDurationMs: number; // Silence hangover duration before speech end (e.g. 700ms)
  speechMinDurationMs: number; // Minimum speech duration to confirm speech start (e.g. 150ms)
  autoBargeIn: boolean; // Auto-interrupt AI playback when user speech starts
}

export interface VadStatus {
  isSpeaking: boolean;
  rms: number;
  db: number;
  threshold: number;
  speechDurationMs: number;
  silenceDurationMs: number;
}

export class AudioController {
  private inputAudioCtx: AudioContext | null = null;
  private outputAudioCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private analyserInput: AnalyserNode | null = null;
  private analyserOutput: AnalyserNode | null = null;

  private nextStartTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private onAudioDataCallback: ((base64Pcm16: string) => void) | null = null;

  private isMuted = false;

  // Voice Activity Detection (VAD) States
  private vadConfig: VadConfig = {
    enabled: true,
    threshold: 0.015,
    silenceDurationMs: 700,
    speechMinDurationMs: 150,
    autoBargeIn: true,
  };

  private isSpeechActive = false;
  private speechStartTime = 0;
  private silenceStartTime = 0;
  private lastRms = 0;

  private onVadStatusCallback: ((status: VadStatus) => void) | null = null;
  private onSpeechStartCallback: (() => void) | null = null;
  private onSpeechEndCallback: (() => void) | null = null;

  public setVadConfig(config: Partial<VadConfig>) {
    this.vadConfig = { ...this.vadConfig, ...config };
  }

  public getVadConfig(): VadConfig {
    return { ...this.vadConfig };
  }

  public onVadStatus(cb: (status: VadStatus) => void) {
    this.onVadStatusCallback = cb;
  }

  public onSpeechStart(cb: () => void) {
    this.onSpeechStartCallback = cb;
  }

  public onSpeechEnd(cb: () => void) {
    this.onSpeechEndCallback = cb;
  }

  public hasActivePlayback(): boolean {
    return this.activeSources.length > 0;
  }

  public async startInput(onAudioData: (base64Pcm16: string) => void) {
    this.onAudioDataCallback = onAudioData;

    try {
      this.inputAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });

      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const source = this.inputAudioCtx.createMediaStreamSource(this.micStream);
      this.analyserInput = this.inputAudioCtx.createAnalyser();
      this.analyserInput.fftSize = 64;

      // ScriptProcessor to grab raw PCM
      this.scriptProcessor = this.inputAudioCtx.createScriptProcessor(4096, 1, 1);

      this.scriptProcessor.onaudioprocess = (e) => {
        if (this.isMuted) return;

        const inputBuffer = e.inputBuffer;
        const channelData = inputBuffer.getChannelData(0);

        // VAD RMS Energy Calculation
        let sumSq = 0;
        for (let i = 0; i < channelData.length; i++) {
          sumSq += channelData[i] * channelData[i];
        }
        const rms = Math.sqrt(sumSq / channelData.length);
        const db = 20 * Math.log10(Math.max(rms, 0.00001));
        this.lastRms = rms;

        // Process Voice Activity Detection
        if (this.vadConfig.enabled) {
          const now = performance.now();
          if (rms >= this.vadConfig.threshold) {
            this.silenceStartTime = 0;
            if (!this.isSpeechActive) {
              if (this.speechStartTime === 0) {
                this.speechStartTime = now;
              } else if (now - this.speechStartTime >= this.vadConfig.speechMinDurationMs) {
                this.isSpeechActive = true;
                // Auto barge-in: stop AI playback when user starts speaking
                if (this.vadConfig.autoBargeIn && this.activeSources.length > 0) {
                  this.stopPlayback();
                }
                if (this.onSpeechStartCallback) this.onSpeechStartCallback();
              }
            }
          } else {
            this.speechStartTime = 0;
            if (this.isSpeechActive) {
              if (this.silenceStartTime === 0) {
                this.silenceStartTime = now;
              } else if (now - this.silenceStartTime >= this.vadConfig.silenceDurationMs) {
                this.isSpeechActive = false;
                this.silenceStartTime = 0;
                if (this.onSpeechEndCallback) this.onSpeechEndCallback();
              }
            }
          }

          if (this.onVadStatusCallback) {
            this.onVadStatusCallback({
              isSpeaking: this.isSpeechActive,
              rms,
              db,
              threshold: this.vadConfig.threshold,
              speechDurationMs: this.isSpeechActive ? now - this.speechStartTime : 0,
              silenceDurationMs:
                !this.isSpeechActive && this.silenceStartTime ? now - this.silenceStartTime : 0,
            });
          }
        }

        // Convert Float32Array to 16-bit PCM little-endian
        const pcm16 = this.float32ToPcm16(channelData);
        const base64 = this.arrayBufferToBase64(pcm16.buffer);

        if (this.onAudioDataCallback && base64) {
          this.onAudioDataCallback(base64);
        }
      };

      source.connect(this.analyserInput);
      this.analyserInput.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.inputAudioCtx.destination);
    } catch (err) {
      console.error('Error starting microphone input:', err);
      throw err;
    }
  }

  public initOutput() {
    if (!this.outputAudioCtx) {
      this.outputAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 24000,
      });
      this.analyserOutput = this.outputAudioCtx.createAnalyser();
      this.analyserOutput.fftSize = 64;
      this.analyserOutput.connect(this.outputAudioCtx.destination);
      this.nextStartTime = this.outputAudioCtx.currentTime;
    }
    if (this.outputAudioCtx.state === 'suspended') {
      this.outputAudioCtx.resume();
    }
  }

  public playChunk(base64Pcm24: string) {
    this.initOutput();
    if (!this.outputAudioCtx || !this.analyserOutput) return;

    try {
      const pcm16 = this.base64ToArrayBuffer(base64Pcm24);
      const float32 = this.pcm16ToFloat32(new Int16Array(pcm16));

      const buffer = this.outputAudioCtx.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);

      const source = this.outputAudioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.analyserOutput);

      const now = this.outputAudioCtx.currentTime;
      if (this.nextStartTime < now) {
        this.nextStartTime = now;
      }

      source.start(this.nextStartTime);
      this.nextStartTime += buffer.duration;
      this.activeSources.push(source);

      source.onended = () => {
        const idx = this.activeSources.indexOf(source);
        if (idx > -1) this.activeSources.splice(idx, 1);
      };
    } catch (err) {
      console.error('Error playing 24kHz audio chunk:', err);
    }
  }

  public stopPlayback() {
    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch (e) {
        // Source already stopped
      }
    }
    this.activeSources = [];
    if (this.outputAudioCtx) {
      this.nextStartTime = this.outputAudioCtx.currentTime;
    }
  }

  public setMute(muted: boolean) {
    this.isMuted = muted;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  public getLevels(): { input: number; output: number } {
    let inputVol = 0;
    let outputVol = 0;

    if (this.analyserInput) {
      const data = new Uint8Array(this.analyserInput.frequencyBinCount);
      this.analyserInput.getByteFrequencyData(data);
      inputVol = data.reduce((a, b) => a + b, 0) / data.length / 255;
    }

    if (this.analyserOutput) {
      const data = new Uint8Array(this.analyserOutput.frequencyBinCount);
      this.analyserOutput.getByteFrequencyData(data);
      outputVol = data.reduce((a, b) => a + b, 0) / data.length / 255;
    }

    return { input: inputVol, output: outputVol };
  }

  public stopAll() {
    this.stopPlayback();

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }

    if (this.inputAudioCtx) {
      this.inputAudioCtx.close();
      this.inputAudioCtx = null;
    }

    if (this.outputAudioCtx) {
      this.outputAudioCtx.close();
      this.outputAudioCtx = null;
    }
  }

  // Conversion Helpers
  private float32ToPcm16(float32Array: Float32Array): Int16Array {
    const pcm16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm16;
  }

  private pcm16ToFloat32(int16Array: Int16Array): Float32Array {
    const float32 = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32[i] = int16Array[i] / (int16Array[i] < 0 ? 32768 : 32767);
    }
    return float32;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
