/**
 * Video streaming utility for Beatrice OSS.
 * Captures camera feed or screen share and extracts JPEG frames at specified interval (~1 FPS)
 * to stream into Eburon Live API for real-time vision capabilities.
 */

export type CameraFacingMode = 'user' | 'environment';

export class VideoController {
  private mediaStream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private frameIntervalTimer: number | null = null;
  private streamType: 'camera' | 'screen' | 'off' = 'off';
  private facingMode: CameraFacingMode = 'user';

  public async startCamera(
    videoElement: HTMLVideoElement,
    onFrame: (base64Jpeg: string) => void,
    fps = 1,
    facingMode: CameraFacingMode = 'user'
  ): Promise<MediaStream> {
    this.stop();
    this.videoElement = videoElement;
    this.streamType = 'camera';
    this.facingMode = facingMode;

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: facingMode,
      },
    });

    this.videoElement.srcObject = this.mediaStream;
    await this.videoElement.play().catch(() => {});

    this.startFrameExtraction(onFrame, fps);
    return this.mediaStream;
  }

  public getFacingMode(): CameraFacingMode {
    return this.facingMode;
  }

  public async startScreenShare(
    videoElement: HTMLVideoElement,
    onFrame: (base64Jpeg: string) => void,
    fps = 1
  ): Promise<MediaStream> {
    this.stop();
    this.videoElement = videoElement;
    this.streamType = 'screen';

    this.mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'monitor',
      },
      audio: false,
    });

    // Handle user stopping screen share via browser bar
    this.mediaStream.getVideoTracks()[0].onended = () => {
      this.stop();
    };

    this.videoElement.srcObject = this.mediaStream;
    await this.videoElement.play().catch(() => {});

    this.startFrameExtraction(onFrame, fps);
    return this.mediaStream;
  }

  private startFrameExtraction(onFrame: (base64Jpeg: string) => void, fps: number) {
    if (!this.canvasElement) {
      this.canvasElement = document.createElement('canvas');
    }

    const intervalMs = Math.max(500, Math.floor(1000 / fps)); // Max 2 FPS (500ms), default 1 FPS (1000ms)

    this.frameIntervalTimer = window.setInterval(() => {
      if (!this.videoElement || !this.canvasElement || !this.mediaStream) return;
      if (this.videoElement.readyState < 2) return; // HAVE_CURRENT_DATA

      const width = this.videoElement.videoWidth || 640;
      const height = this.videoElement.videoHeight || 360;

      // Scale down image if large to optimize network load
      const maxDim = 800;
      let targetW = width;
      let targetH = height;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          targetW = maxDim;
          targetH = Math.round((height * maxDim) / width);
        } else {
          targetH = maxDim;
          targetW = Math.round((width * maxDim) / height);
        }
      }

      this.canvasElement.width = targetW;
      this.canvasElement.height = targetH;

      const ctx = this.canvasElement.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(this.videoElement, 0, 0, targetW, targetH);

      // Get Base64 JPEG string (omit data:image/jpeg;base64, prefix)
      const dataUrl = this.canvasElement.toDataURL('image/jpeg', 0.7);
      const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');

      if (base64) {
        onFrame(base64);
      }
    }, intervalMs);
  }

  public takeSnapshot(): string | null {
    if (!this.videoElement || this.videoElement.readyState < 2) return null;
    const canvas = document.createElement('canvas');
    canvas.width = this.videoElement.videoWidth || 640;
    canvas.height = this.videoElement.videoHeight || 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(this.videoElement, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  public getStreamType(): 'camera' | 'screen' | 'off' {
    return this.streamType;
  }

  public stop() {
    if (this.frameIntervalTimer) {
      clearInterval(this.frameIntervalTimer);
      this.frameIntervalTimer = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }

    this.streamType = 'off';
  }
}
