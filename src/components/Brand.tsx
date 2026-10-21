import { BRAND, LOGO_LIGHT } from './brandAssets.js'

export { BRAND }

/** The VocalStack wordmark. Contentful's editor is light, so the light artwork only. */
export const Logo: React.FC<{ height?: number }> = ({ height = 16 }) => (
  <span aria-label="VocalStack" role="img" style={{ display: 'inline-flex', height, lineHeight: 0, verticalAlign: 'middle' }}>
    <span className="vs-art" dangerouslySetInnerHTML={{ __html: LOGO_LIGHT }} style={{ display: 'inline-flex', height: '100%' }} />
    <style>{'.vs-art svg { height: 100%; width: auto; }'}</style>
  </span>
)
