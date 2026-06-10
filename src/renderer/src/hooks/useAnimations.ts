import gsap from 'gsap'
import { useEffect, useRef } from 'react'

/**
 * Pulse animation cho status dots (sidebar, dashboard)
 * Alternates box-shadow giữa dim và bright.
 */
export function usePulseGlow(
  dimShadow = '0 0 4px rgba(0, 217, 146, 0.3)',
  brightShadow = '0 0 10px rgba(0, 217, 146, 0.7)',
  duration = 2.5,
) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const tween = gsap.to(ref.current, {
      boxShadow: brightShadow,
      opacity: 1,
      duration: duration / 2,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    })
    // Set initial state
    gsap.set(ref.current, { boxShadow: dimShadow, opacity: 0.8 })

    return () => {
      tween.kill()
    }
  }, [dimShadow, brightShadow, duration])

  return ref
}

/**
 * Slide-in from bottom with fade for entrance animations.
 */
export function useSlideIn(y = 12, duration = 0.4, delay = 0, ease = 'power2.out') {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    gsap.fromTo(ref.current, { opacity: 0, y }, { opacity: 1, y: 0, duration, delay, ease })
  }, [y, duration, delay, ease])

  return ref
}

/**
 * Slide down from top with fade (for panels/dropdowns).
 */
export function useSlideDown(active: boolean, duration = 0.25) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    if (active) {
      gsap.fromTo(
        ref.current,
        { opacity: 0, y: -6 },
        { opacity: 1, y: 0, duration, ease: 'back.out(1.7)' },
      )
    }
  }, [active, duration])

  return ref
}

/**
 * Scale-pulse glow effect (for background radial glow elements).
 */
export function useGlowPulse(duration = 6) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const tween = gsap.to(ref.current, {
      scale: 1.15,
      opacity: 1,
      duration: duration / 2,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    })
    gsap.set(ref.current, { scale: 1, opacity: 0.6 })

    return () => {
      tween.kill()
    }
  }, [duration])

  return ref
}

/**
 * Card entrance animation: fade-in + slide up with stagger delay.
 */
export function useCardEntrance(delay = 0, duration = 0.4) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    gsap.fromTo(
      ref.current,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration, delay, ease: 'power2.out' },
    )
  }, [delay, duration])

  return ref
}

/**
 * Recording dot pulse animation.
 */
export function useRecordingPulse(active: boolean) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!ref.current || !active) return
    const tween = gsap.to(ref.current, {
      scale: 1.4,
      opacity: 0.4,
      duration: 0.6,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    })

    return () => {
      tween.kill()
      if (ref.current) {
        gsap.set(ref.current, { scale: 1, opacity: 1 })
      }
    }
  }, [active])

  return ref
}

/**
 * Button glow pulse (e.g. stop button red glow).
 */
export function useBtnGlow(
  active: boolean,
  dimShadow = '0 0 8px rgba(255, 77, 79, 0.3)',
  brightShadow = '0 0 16px rgba(255, 77, 79, 0.5)',
) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!ref.current || !active) return
    gsap.set(ref.current, { boxShadow: dimShadow })
    const tween = gsap.to(ref.current, {
      boxShadow: brightShadow,
      duration: 1,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    })

    return () => {
      tween.kill()
    }
  }, [active, dimShadow, brightShadow])

  return ref
}

/**
 * Entry slide-in animation (for transcript entries).
 * Runs once when the element mounts.
 */
export function useEntryIn() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    gsap.fromTo(
      ref.current,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.35, ease: 'back.out(1.7)' },
    )
  }, [])

  return ref
}

/**
 * Loading pulse (opacity oscillation for processing entries).
 */
export function useLoadingPulse(active: boolean) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current || !active) return
    const tween = gsap.to(ref.current, {
      opacity: 0.6,
      duration: 0.75,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    })

    return () => {
      tween.kill()
    }
  }, [active])

  return ref
}
