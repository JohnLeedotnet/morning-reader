import { useState, useRef, useEffect, useCallback } from 'react'

export interface RecordingMetrics {
  total_duration_s: number
  silence_count: number
  max_silence_s: number
  total_silence_s: number
  recording_start_ts: string
}

function pickLocalMic(inputs: MediaDeviceInfo[]): string {
  const isContinuity = (label: string) =>
    /iphone|ipad|airpods|手机|耳机|continuity|连续互通/i.test(label)
  const local   = inputs.filter(d => !isContinuity(d.label))
  const builtin = local.find(d => /built-?in|macbook|mac mini|imac|内建|内置/i.test(d.label))
  if (builtin) return builtin.deviceId
  if (local.length > 0) return local[0].deviceId
  return inputs[0]?.deviceId ?? ''
}

export function useReadingRecorder({ maxConsecutiveSilenceS = 15 } = {}) {
  const [isRecording, setIsRecording] = useState(false)
  const [durationS, setDurationS] = useState(0)
  const [peakLevel, setPeakLevel] = useState(0)
  const [silenceCount, setSilenceCount] = useState(0)
  const [currentSilenceS, setCurrentSilenceS] = useState(0)
  const [totalSilenceS, setTotalSilenceS] = useState(0)
  const [maxSilenceS, setMaxSilenceS] = useState(0)
  const [voiceStatus, setVoiceStatus] = useState<'normal' | 'too_quiet' | 'long_pause'>('normal')
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')

  const audioCtxRef = useRef<AudioContext | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const rafRef = useRef(0)
  const durationTimerRef = useRef(0)
  const startTimeRef = useRef(0)

  // Silence tracking (read in RAF, avoid re-render overhead)
  const silenceStartRef = useRef<number | null>(null)
  const inSilenceEpisodeRef = useRef(false)
  const silenceCountRef = useRef(0)
  const totalSilenceRef = useRef(0)
  const maxSilenceRef = useRef(0)
  const maxSilenceConfigRef = useRef(maxConsecutiveSilenceS)
  useEffect(() => { maxSilenceConfigRef.current = maxConsecutiveSilenceS }, [maxConsecutiveSilenceS])

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(devs => {
      const inputs = devs.filter(d => d.kind === 'audioinput')
      setDevices(inputs)
      setSelectedDeviceId(pickLocalMic(inputs))
    }).catch(() => {})

    return () => {
      clearInterval(durationTimerRef.current)
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
      audioCtxRef.current?.close()
    }
  }, [])

  useEffect(() => {
    const refresh = () => {
      navigator.mediaDevices.enumerateDevices().then(devs => {
        const inputs = devs.filter(d => d.kind === 'audioinput')
        setDevices(inputs)
        setSelectedDeviceId(prev =>
          inputs.some(d => d.deviceId === prev) ? prev : pickLocalMic(inputs)
        )
      }).catch(() => {})
    }
    navigator.mediaDevices.addEventListener?.('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', refresh)
  }, [])

  const start = useCallback(async () => {
    const constraints: MediaStreamConstraints = {
      audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true,
    }
    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    streamRef.current = stream

    const ctx = new AudioContext()
    audioCtxRef.current = ctx
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    ctx.createMediaStreamSource(stream).connect(analyser)
    setAnalyserNode(analyser)

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/mp4'
    const recorder = new MediaRecorder(stream, { mimeType })
    mediaRecorderRef.current = recorder
    chunksRef.current = []
    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    recorder.start(500)

    startTimeRef.current = Date.now()
    silenceStartRef.current = null
    inSilenceEpisodeRef.current = false
    silenceCountRef.current = 0
    totalSilenceRef.current = 0
    maxSilenceRef.current = 0
    setIsRecording(true)
    setDurationS(0)
    setSilenceCount(0)
    setCurrentSilenceS(0)
    setTotalSilenceS(0)
    setMaxSilenceS(0)
    setVoiceStatus('normal')
    setPeakLevel(0)

    durationTimerRef.current = window.setInterval(() => {
      setDurationS(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)

    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    const SILENCE_THRESHOLD = 0.01

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick)
      analyser.getByteTimeDomainData(dataArray)

      let sum = 0
      for (const v of dataArray) { const x = v / 128 - 1; sum += x * x }
      const rms = Math.sqrt(sum / dataArray.length)
      setPeakLevel(rms)

      const now = Date.now()

      if (rms < SILENCE_THRESHOLD) {
        if (silenceStartRef.current === null) silenceStartRef.current = now
        const elapsed = (now - silenceStartRef.current) / 1000

        if (elapsed >= 0.5 && !inSilenceEpisodeRef.current) {
          inSilenceEpisodeRef.current = true
          silenceCountRef.current++
          setSilenceCount(silenceCountRef.current)
        }

        if (inSilenceEpisodeRef.current) {
          setCurrentSilenceS(elapsed)
          if (elapsed > maxSilenceRef.current) {
            maxSilenceRef.current = elapsed
            setMaxSilenceS(elapsed)
          }
          if (elapsed >= maxSilenceConfigRef.current) setVoiceStatus('long_pause')
          else if (rms < 0.005) setVoiceStatus('too_quiet')
        }
      } else {
        if (silenceStartRef.current !== null && inSilenceEpisodeRef.current) {
          totalSilenceRef.current += (now - silenceStartRef.current) / 1000
          setTotalSilenceS(totalSilenceRef.current)
        }
        silenceStartRef.current = null
        inSilenceEpisodeRef.current = false
        setCurrentSilenceS(0)
        setVoiceStatus('normal')
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [selectedDeviceId])

  const stopAndGetResult = useCallback((): Promise<{ blob: Blob; metrics: RecordingMetrics }> => {
    return new Promise((resolve, reject) => {
      const recorder = mediaRecorderRef.current
      if (!recorder) { reject(new Error('Not recording')); return }

      clearInterval(durationTimerRef.current)
      cancelAnimationFrame(rafRef.current)

      let finalTotal = totalSilenceRef.current
      if (silenceStartRef.current !== null && inSilenceEpisodeRef.current) {
        finalTotal += (Date.now() - silenceStartRef.current) / 1000
      }
      const metrics: RecordingMetrics = {
        total_duration_s: Math.floor((Date.now() - startTimeRef.current) / 1000),
        silence_count: silenceCountRef.current,
        max_silence_s: Math.round(maxSilenceRef.current),
        total_silence_s: Math.round(finalTotal),
        recording_start_ts: new Date(startTimeRef.current).toISOString(),
      }

      streamRef.current?.getTracks().forEach(t => t.stop())
      setAnalyserNode(null)

      const mimeType = recorder.mimeType
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType })
        audioCtxRef.current?.close().catch(() => {})
        audioCtxRef.current = null
        resolve({ blob, metrics })
      }
      recorder.stop()
      setIsRecording(false)
      setVoiceStatus('normal')
      setPeakLevel(0)
    })
  }, [])

  return {
    isRecording, start, stopAndGetResult,
    durationS, peakLevel,
    silenceCount, currentSilenceS, totalSilenceS, maxSilenceS,
    voiceStatus,
    analyserNode,
    selectedDeviceId, setSelectedDeviceId, devices,
  }
}
