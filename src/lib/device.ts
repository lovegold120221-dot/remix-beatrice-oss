import { DeviceType } from '../types';

// Detects whether the current client device is a mobile phone/tablet or a desktop.
// Used to decide how the agent opens a "local" terminal: in-browser on desktop,
// Termius (SSH) on mobile.
export function detectDeviceType(): DeviceType {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua)) {
    return 'mobile';
  }
  if (typeof window !== 'undefined' && window.innerWidth <= 768) {
    return 'mobile';
  }
  return 'desktop';
}
