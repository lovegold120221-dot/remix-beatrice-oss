import type { GenerationTaskType } from '../../types/generation';

const CENTER_GLYPHS: Record<string, string> = {
  video: '▶',
  image: '✦',
  audio: '♪',
};

/**
 * Animated "video player" placeholder shown while a media task (image / video /
 * audio) is generating. Purely visual — no text, no model names, no source
 * material. The finished result replaces it via the normal result preview.
 */
export function MediaStageAnimation({ type }: { type: GenerationTaskType }) {
  return (
    <div
      className="relative mt-3 overflow-hidden rounded-xl bg-black/50 border border-white/10 aspect-video grid place-items-center select-none"
      role="status"
      aria-label={`Generating ${type}`}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(115deg,rgba(0,242,254,0.10)_0%,rgba(79,172,254,0.16)_20%,transparent_40%,transparent_60%,rgba(0,242,254,0.10)_80%,rgba(79,172,254,0.16)_100%)] bg-[length:200%_100%]"
        style={{ animation: 'media-shimmer 2.4s linear infinite' }}
      />
      <div
        aria-hidden="true"
        className="absolute left-0 right-0 h-px bg-[linear-gradient(90deg,transparent,#00f2fe,transparent)]"
        style={{ animation: 'media-scan 2.2s ease-in-out infinite' }}
      />
      <div className="relative grid place-items-center" aria-hidden="true">
        <span
          className="absolute inset-0 rounded-full border border-[#00f2fe]/60"
          style={{ animation: 'media-ring 1.8s cubic-bezier(0.2, 0.6, 0.4, 1) infinite' }}
        />
        <span
          className="absolute inset-0 rounded-full border border-[#4facfe]/40"
          style={{ animation: 'media-ring 1.8s 0.6s cubic-bezier(0.2, 0.6, 0.4, 1) infinite' }}
        />
        <span
          className="relative w-14 h-14 rounded-full grid place-items-center bg-[linear-gradient(135deg,#00f2fe,#4facfe)] text-black text-xl shadow-[0_8px_24px_-6px_rgba(0,242,254,0.6)]"
          style={{ animation: 'media-glow 1.6s ease-in-out infinite' }}
        >
          {CENTER_GLYPHS[type] || '✦'}
        </span>
      </div>
    </div>
  );
}