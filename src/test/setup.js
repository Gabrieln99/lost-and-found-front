import { config, RouterLinkStub } from '@vue/test-utils'

// The app registers RouterLink globally via `app.use(router)` in main.js.
// Specs don't install the router, so stub RouterLink everywhere. This is
// inert for any spec whose component tree renders no <RouterLink>.
config.global.stubs.RouterLink = RouterLinkStub
