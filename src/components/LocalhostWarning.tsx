import { Flex, Note, Paragraph } from '@contentful/f36-components'

/** Shown when the dev server is opened directly instead of inside Contentful. */
const LocalhostWarning = () => (
  <Flex justifyContent="center" marginTop="spacingXl">
    <Note title="Open this app in Contentful" variant="warning">
      <Paragraph>
        Contentful apps run inside the Contentful web app. Set your app definition's Frontend to http://localhost:5173, then open the app from a space it is installed in.
      </Paragraph>
    </Note>
  </Flex>
)

export default LocalhostWarning
