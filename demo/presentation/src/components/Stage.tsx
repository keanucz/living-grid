import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { COLORS, FONT, MONO } from '../theme'
import type { Fig } from '../data'
import { generatedAt } from '../data'

/** The frame every scene sits in: site background, kicker, and a quiet source line. */
export const Stage: React.FC<{ kicker?: string; sources?: Fig[]; children: React.ReactNode }> = ({ kicker, sources = [], children }) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const fade = Math.min(interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' }), interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' }))
  const uniq = [...new Set(sources.map((s) => s.src))]
  return (
    <AbsoluteFill style={{ background: COLORS.bg, color: COLORS.text, fontFamily: FONT, opacity: fade }}>
      <AbsoluteFill style={{ padding: '88px 120px 96px' }}>
        {kicker && <div style={{ fontFamily: MONO, fontSize: 22, letterSpacing: '0.08em', textTransform: 'uppercase', color: COLORS.text3, marginBottom: 18 }}>{kicker}</div>}
        {children}
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: 120, right: 120, bottom: 36, display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 18, color: COLORS.text3 }}>
        <span>The Living Grid</span>
        <span>{uniq.length ? `Source: ${uniq.join(', ')} · ${generatedAt.slice(0, 16).replace('T', ' ')} UTC` : ''}</span>
      </div>
    </AbsoluteFill>
  )
}
