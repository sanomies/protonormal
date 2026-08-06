// Stereo, music-bitrate Opus still has no WebRTC API in 2026 — the fmtp line
// must be edited in the SDP by hand. Opus fmtp parameters are what the
// *receiver* wants, so callers apply this to BOTH our local description (so
// the remote sends us hi-fi) and the remote description before
// setRemoteDescription (so our encoder sends hi-fi). Only the instrument
// m-line is touched; voice stays at Opus defaults.
const INSTRUMENT_OPUS_PARAMS: Record<string, string> = {
  stereo: '1',
  'sprop-stereo': '1',
  maxaveragebitrate: '256000',
  maxplaybackrate: '48000',
  cbr: '0',
  useinbandfec: '1',
  // DTX gates "silence" — it audibly chokes sustained notes and reverb tails.
  usedtx: '0',
}

export function mungeInstrumentOpus(sdp: string, instrumentMid: string): string {
  const lines = sdp.split('\r\n')

  // Locate the media section whose a=mid: matches the instrument transceiver.
  let sectionStart = -1
  let sectionEnd = lines.length
  let current = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.startsWith('m=')) {
      if (sectionStart !== -1) {
        sectionEnd = i
        break
      }
      current = i
    } else if (line === `a=mid:${instrumentMid}` && current !== -1) {
      sectionStart = current
    }
  }
  if (sectionStart === -1) return sdp

  let opusPt: string | null = null
  let rtpmapIdx = -1
  for (let i = sectionStart; i < sectionEnd; i++) {
    const m = /^a=rtpmap:(\d+) opus\/48000/.exec(lines[i]!)
    if (m) {
      opusPt = m[1]!
      rtpmapIdx = i
      break
    }
  }
  if (opusPt === null) return sdp

  const fmtpPrefix = `a=fmtp:${opusPt} `
  for (let i = sectionStart; i < sectionEnd; i++) {
    const line = lines[i]!
    if (!line.startsWith(fmtpPrefix)) continue
    const params = new Map<string, string>()
    for (const kv of line.slice(fmtpPrefix.length).split(';')) {
      const eq = kv.indexOf('=')
      if (eq === -1) params.set(kv.trim(), '')
      else params.set(kv.slice(0, eq).trim(), kv.slice(eq + 1).trim())
    }
    for (const [k, v] of Object.entries(INSTRUMENT_OPUS_PARAMS)) params.set(k, v)
    lines[i] =
      fmtpPrefix +
      [...params.entries()].map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join(';')
    return lines.join('\r\n')
  }

  const fmtp =
    fmtpPrefix +
    Object.entries(INSTRUMENT_OPUS_PARAMS)
      .map(([k, v]) => `${k}=${v}`)
      .join(';')
  lines.splice(rtpmapIdx + 1, 0, fmtp)
  return lines.join('\r\n')
}
