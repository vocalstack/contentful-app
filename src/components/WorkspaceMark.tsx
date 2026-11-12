import tokens from '@contentful/f36-tokens'
import { useEffect, useState } from 'react'

import { type Workspace, workspaceHue, workspaceInitials } from '../workspace.js'

const PERSON =
  'M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z'

/**
 * A workspace's mark, as the VocalStack dashboard draws it: its own icon when it has one,
 * a person for the personal workspace, else its initials on a tile of its colour.
 * `iconSrc` is the icon's whole address; when it does not load, the mark falls back.
 */
export const WorkspaceMark: React.FC<{ iconSrc?: string; size?: number; workspace: Pick<Workspace, 'id' | 'name' | 'personal'> }> = ({ iconSrc, size = 36, workspace }) => {
  const [broken, setBroken] = useState<string>()
  useEffect(() => setBroken(undefined), [iconSrc])
  const tile: React.CSSProperties = {
    alignItems: 'center',
    borderRadius: Math.round(size * 0.29),
    display: 'inline-flex',
    flex: 'none',
    fontSize: Math.round(size * 0.39),
    fontWeight: 600,
    height: size,
    justifyContent: 'center',
    letterSpacing: '.02em',
    lineHeight: 1,
    overflow: 'hidden',
    width: size,
  }
  if (iconSrc && broken !== iconSrc) {
    return (
      <span aria-hidden="true" data-test-id="workspace-mark" style={{ ...tile, background: tokens.gray100, boxShadow: `inset 0 0 0 1px ${tokens.gray300}` }}>
        <img alt="" draggable={false} onError={() => setBroken(iconSrc)} src={iconSrc} style={{ display: 'block', height: '100%', objectFit: 'cover', width: '100%' }} />
      </span>
    )
  }
  if (workspace.personal) {
    const glyph = Math.round(size * 0.55)
    return (
      <span aria-hidden="true" data-test-id="workspace-mark" style={{ ...tile, background: tokens.gray200, boxShadow: `inset 0 0 0 1px ${tokens.gray300}`, color: tokens.gray700 }}>
        <svg fill="none" height={glyph} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} viewBox="0 0 24 24" width={glyph}>
          <path d={PERSON} />
        </svg>
      </span>
    )
  }
  const colour = `oklch(.66 .13 ${workspaceHue(workspace.id)})`
  return (
    <span
      aria-hidden="true"
      data-test-id="workspace-mark"
      style={{
        ...tile,
        background: `color-mix(in oklab, ${colour} 22%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${colour} 30%, transparent)`,
        color: `color-mix(in oklab, ${colour} 72%, ${tokens.gray900})`,
      }}
    >
      {workspaceInitials(workspace.name)}
    </span>
  )
}
