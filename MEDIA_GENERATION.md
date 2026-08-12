# Media Generation Flow — Beatrice OSS (QwenCloud / DashScope)

This document defines the exact flow Beatrice follows when the Boss asks for image, video, or speech generation. It is based on the real tool declarations in `server.ts` and the QwenCloud / DashScope APIs configured in this deployment.

## Authorization rule (non-negotiable)

Beatrice only calls media-generation tools when the Boss **explicitly** asks to:
- "generate an image" / "create a picture" / "make an image"
- "edit this image"
- "generate a video" / "create a video" / "animate this"
- "text-to-speech" / "narrate this" / "read this aloud"

If the request is ambiguous, Beatrice asks for confirmation rather than guessing.

## Tool selection decision tree

| Boss request | Tool to call | Notes |
|--------------|--------------|-------|
| Create/generate a new image | `qwenImageGenerate` | Wan 2.7 image models via QwenCloud |
| Edit an existing image | `qwenImageEdit` | Requires source image URL/path/base64 |
| Generate a video (premium/1080P/lip-sync) | `qwenVideoGenerate` | Wan 2.7 t2v via QwenCloud; supports 720P/1080P, audio_url lip-sync |
| Generate a short cinematic clip (480P/720P) | `generateVideo` | DashScope wan2.7-t2v; simpler defaults |
| Convert text to speech | `qwenTts` | qwen3-tts-flash via QwenCloud |

## Exact parameters and defaults

### 1. `qwenImageGenerate` — new images

Required: `prompt`
Optional defaults:
- `model`: `"wan2.7-image-pro"` (fallback chain: `wan2.7-image-pro` then `wan2.7-image`)
- `size`: `"1K"` (valid: `1K`, `2K`, `4K`, or `width*height`)
- `n`: `1` (number of images)
- `watermark`: `false`
- `thinking_mode`: `true` (enable for better quality)
- `enable_sequential`: `false`

Example call:
```json
{
  "prompt": "A cinematic portrait of a woman reading by a rainy window, soft natural light, photorealistic",
  "model": "wan2.7-image-pro",
  "size": "1K",
  "n": 1,
  "watermark": false,
  "thinking_mode": true
}
```

### 2. `qwenImageEdit` — image editing

Required: `instruction`, `images` (array of URLs/paths/base64)
Optional defaults:
- `model`: `"wan2.7-image-pro"` (fallback chain: `wan2.7-image-pro` then `wan2.7-image`)
- `size`: `"1K"`
- `n`: `1`
- `watermark`: `false`
- `bbox_list`: omitted unless Boss specifies a region

Example call:
```json
{
  "instruction": "Change the background to a sunny beach and make the colors warmer",
  "images": ["https://example.com/photo.jpg"],
  "model": "wan2.7-image-pro",
  "size": "1K",
  "n": 1
}
```

### 3. `qwenVideoGenerate` — premium video generation

Required: `prompt`
Optional defaults:
- `model`: `"happyhorse-1.1-t2v"` (fallback chain: `happyhorse-1.1-t2v` → `wan3.0-video` → `wan2.7-t2v` → `wan2.6-t2v`)
- `resolution`: `"720P"` (valid: `480P`, `720P`, `1080P`)
- `ratio`: `"16:9"` (valid: `16:9`, `9:16`, `1:1`)
- `duration`: `5` (model-dependent, typically 2–15s)
- `prompt_extend`: `true` (Wan models)
- `watermark`: `false` (Wan models)
- `audio_url`: optional audio URL for lip-sync / audio-driven generation

Example call:
```json
{
  "prompt": "A serene aerial shot of a turquoise ocean meeting a white sand beach at sunrise, gentle waves, cinematic",
  "resolution": "720P",
  "ratio": "16:9",
  "duration": 5,
  "prompt_extend": true,
  "watermark": false
}
```

### 4. `generateVideo` — DashScope short clips

Required: `prompt`
Optional defaults:
- `size`: `"1280*720"` (any `width*height` supported by the model)
- `duration`: `10`
- `audio`: `true`
- `shot_type`: `"multi"` (or `single`)
- `prompt_extend`: `true`
- Model chain: `happyhorse-1.1-t2v` → `wan3.0-video` → `wan2.7-t2v` → `wan2.6-t2v`

Use this when the Boss wants a quick cinematic clip. This handler matches the working curl example shape (`wan2.6-t2v`, `size`, `duration`, `audio`, `shot_type`) but now prefers current QwenCloud models first.

### 5. `qwenTts` — speech synthesis

Required: `text`
Optional defaults:
- `voice`: `"Cherry"` (valid examples: `Cherry`, `Ethan`)
- `model`: `"qwen3-tts-flash"` (fallback chain: `qwen3-tts-flash` then `qwen3-tts`)
- `language_type`: `"Auto"` (valid: `Auto`, `Chinese`, `English`, etc.)

Example call:
```json
{
  "text": "Welcome to Beatrice. I'm here to help you with anything you need.",
  "voice": "Cherry",
  "model": "qwen3-tts-flash",
  "language_type": "Auto"
}
```

## Model fallback chains (server-side shuffle)

All QwenCloud media handlers now automatically fall back to the next model in the chain when the primary fails at submission or during async polling.

| Tool | Default chain | Override rule |
|------|---------------|---------------|
| `qwenImageGenerate` / `qwenImageEdit` | `wan2.7-image-pro` -> `wan2.7-image` | If Boss specifies `model`, only that model is tried |
| `qwenVideoGenerate` | `happyhorse-1.1-t2v` -> `wan3.0-video` -> `wan2.7-t2v` -> `wan2.6-t2v` | If Boss specifies `model`, only that model is tried |
| `generateVideo` | `happyhorse-1.1-t2v` -> `wan3.0-video` -> `wan2.7-t2v` -> `wan2.6-t2v` | No `model` parameter exposed |
| `qwenTts` | `qwen3-tts-flash` -> `qwen3-tts` | If Boss specifies `model`, only that model is tried |

The `model` field is included in all broadcast updates so the UI and logs show which model actually succeeded.

## Execution flow

1. **Explicit authorization check** — confirm the Boss asked for media generation.
2. **Classify media type** — image / image-edit / video / speech.
3. **Select the right tool** from the decision table above.
4. **Set sensible defaults** for all optional parameters (never leave required params empty).
5. **Call the tool** and wait for the result.
6. **Validate the result** — if the tool returns a URL/path, confirm it exists; if it returns an error, report the error exactly.
7. **Present the result** to the Boss: share the URL, describe what was generated, and offer next steps.

## Error handling

| Failure | Beatrice response |
|---------|-------------------|
| `DASHSCOPE_API_KEY` missing / invalid | "Media generation isn't available right now because the DashScope API key isn't configured. Add it to `.env.local` and restart the server." |
| Primary model fails but fallback succeeds | "Generated using the fallback model [model]." |
| All models fail | "All available [type] models failed. Attempted: [model list]. [last error]." |
| Result URL unreachable | "The generation finished but I can't verify the output URL is reachable. Here is the link: [URL]. Let me know if it doesn't load." |
| Ambiguous request | "Do you want me to generate an image, a video, or speech? And what should the content be?" |

## API key requirement

All media tools require `DASHSCOPE_API_KEY` in `.env.local` (already present in this deployment). Without it, the calls will fail at runtime.

## Related files

- Tool handlers: `server/tools.ts`
- Function declarations: `server.ts` (`getFunctionDeclarations`)
- Environment config: `.env.local`
- QwenCloud docs index: `https://docs.qwencloud.com/llms.txt`