// Back camera: getUserMedia into a playsinline muted <video>, optional torch.

/**
 * @param {HTMLVideoElement} video
 * @returns {Promise<{stream: MediaStream, track: MediaStreamTrack, hasTorch: boolean,
 *   setTorch: (on: boolean) => Promise<boolean>, stop: () => void}>}
 */
export async function openCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera access (needs https).');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });
  const track = stream.getVideoTracks()[0];
  Object.assign(video, { muted: true, playsInline: true, autoplay: true, srcObject: stream });
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  await video.play().catch(() => {}); // autoplay rules: muted inline video is allowed
  if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));

  let caps = {};
  try { caps = track.getCapabilities?.() ?? {}; } catch { /* Safari < 17 */ }
  const hasTorch = !!caps.torch;
  return {
    stream, track, hasTorch,
    async setTorch(on) {
      if (!hasTorch) return false;
      try { await track.applyConstraints({ advanced: [{ torch: !!on }] }); return true; } catch { return false; }
    },
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}

/** Friendly text for a getUserMedia error. */
export function cameraErrorText(e) {
  const n = e?.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Camera access was blocked. Allow the camera for this site in Settings > Safari > Camera, then try again.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No back camera was found.';
  if (n === 'NotReadableError') return 'The camera is in use by another app. Close it and try again.';
  return `Could not start the camera: ${e?.message || e}`;
}

/**
 * Map a rectangle in the video element's CSS pixels to source video pixels,
 * for object-fit: cover (the video is scaled up and centered, edges cropped).
 * @param {{x:number,y:number,w:number,h:number}} r rect relative to the video element's box
 */
export function cssRectToVideo(r, elW, elH, vidW, vidH) {
  const s = Math.max(elW / vidW, elH / vidH); // cover scale
  const ox = (elW - vidW * s) / 2, oy = (elH - vidH * s) / 2;
  const x = Math.max(0, (r.x - ox) / s), y = Math.max(0, (r.y - oy) / s);
  const w = Math.min(vidW - x, r.w / s), h = Math.min(vidH - y, r.h / s);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}
